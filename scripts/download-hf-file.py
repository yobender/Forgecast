"""Resume a large Hugging Face file with parallel HTTP range requests."""

from __future__ import annotations

import argparse
import os
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("destination", type=Path)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--reconnect-mb", type=int, default=32)
    return parser.parse_args()


def remote_size(url: str) -> int:
    request = Request(
        url,
        headers={"Range": "bytes=0-0", "Accept-Encoding": "identity"},
    )
    with urlopen(request, timeout=60) as response:
        content_range = response.headers.get("Content-Range", "")
    if "/" not in content_range:
        raise RuntimeError(f"Server did not return a byte range: {content_range!r}")
    return int(content_range.rsplit("/", 1)[1])


def main() -> None:
    args = parse_args()
    destination = args.destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    seed = destination.with_name(destination.name + ".part")
    total = remote_size(args.url)

    if destination.exists() and destination.stat().st_size == total:
        print(f"Already complete: {destination} ({total:,} bytes)", flush=True)
        return

    seed_size = min(seed.stat().st_size if seed.exists() else 0, total)
    remaining = total - seed_size
    if remaining <= 0:
        os.replace(seed, destination)
        print(f"Completed from existing partial: {destination}", flush=True)
        return

    worker_count = max(1, min(args.workers, remaining))
    chunk_dir = destination.with_name(destination.name + ".ranges")
    chunk_dir.mkdir(exist_ok=True)
    span = (remaining + worker_count - 1) // worker_count
    ranges: list[tuple[int, int, Path]] = []
    for index in range(worker_count):
        start = seed_size + index * span
        if start >= total:
            break
        end = min(total - 1, start + span - 1)
        ranges.append((start, end, chunk_dir / f"{index:02d}-{start}-{end}.part"))

    completed = sum(min(path.stat().st_size, end - start + 1) for start, end, path in ranges if path.exists())
    downloaded = seed_size + completed
    progress_lock = threading.Lock()
    last_report = 0.0
    started = time.monotonic()

    def add_progress(amount: int) -> None:
        nonlocal downloaded, last_report
        with progress_lock:
            downloaded += amount
            now = time.monotonic()
            if now - last_report >= 5 or downloaded >= total:
                elapsed = max(now - started, 0.001)
                speed = max(downloaded - seed_size - completed, 0) / elapsed
                print(
                    f"{downloaded / total:6.1%}  {downloaded:,}/{total:,} bytes  {speed / 1_000_000:,.2f} MB/s",
                    flush=True,
                )
                last_report = now

    def download_range(item: tuple[int, int, Path]) -> None:
        start, end, path = item
        expected = end - start + 1
        while (path.stat().st_size if path.exists() else 0) < expected:
            current = path.stat().st_size if path.exists() else 0
            headers = {
                "Range": f"bytes={start + current}-{end}",
                "Accept-Encoding": "identity",
            }
            try:
                request = Request(args.url, headers=headers)
                with urlopen(request, timeout=60) as response:
                    if response.status != 206:
                        raise RuntimeError(f"Expected HTTP 206, got {response.status}")
                    request_bytes = 0
                    with path.open("ab") as output:
                        while block := response.read(1024 * 1024):
                            if not block:
                                continue
                            output.write(block)
                            add_progress(len(block))
                            request_bytes += len(block)
                            if request_bytes >= args.reconnect_mb * 1024 * 1024:
                                break
            except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
                print(f"Retrying range {start}-{end}: {error}", flush=True)
                time.sleep(2)

        if path.stat().st_size != expected:
            raise RuntimeError(f"Range size mismatch for {path.name}")

    print(
        f"Downloading {destination.name}: {total:,} bytes with {len(ranges)} ranges "
        f"({seed_size:,} bytes already present)",
        flush=True,
    )
    with ThreadPoolExecutor(max_workers=len(ranges)) as executor:
        list(executor.map(download_range, ranges))

    assembled = destination.with_name(destination.name + ".assembling")
    with assembled.open("wb") as output:
        if seed_size:
            with seed.open("rb") as source:
                shutil.copyfileobj(source, output, length=8 * 1024 * 1024)
        for _start, _end, path in ranges:
            with path.open("rb") as source:
                shutil.copyfileobj(source, output, length=8 * 1024 * 1024)

    if assembled.stat().st_size != total:
        raise RuntimeError(
            f"Assembled size mismatch: {assembled.stat().st_size:,} != {total:,}"
        )
    os.replace(assembled, destination)
    if seed.exists():
        seed.unlink()
    shutil.rmtree(chunk_dir)
    print(f"Complete: {destination} ({total:,} bytes)", flush=True)


if __name__ == "__main__":
    main()
