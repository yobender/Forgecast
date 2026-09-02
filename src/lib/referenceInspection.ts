export interface ReferenceMetrics {
  width: number
  height: number
  bytes: number
}

export interface ReferenceInspection extends ReferenceMetrics {
  warnings: string[]
}

export function referenceWarnings({ width, height, bytes }: ReferenceMetrics): string[] {
  const warnings: string[] = []
  const shortestSide = Math.min(width, height)
  const aspect = width / Math.max(1, height)
  if (shortestSide < 512) warnings.push('Use at least 512 px on the shortest side; small references lose relief and edge detail.')
  if (aspect < 0.42 || aspect > 2.4) warnings.push('The image is unusually narrow or wide. Leave clear space around the complete subject.')
  if (bytes < 60_000) warnings.push('The file is very small and may contain heavy compression or little image detail.')
  return warnings
}

export async function inspectReference(file: File): Promise<ReferenceInspection> {
  const bitmap = await createImageBitmap(file)
  try {
    const metrics = { width: bitmap.width, height: bitmap.height, bytes: file.size }
    return { ...metrics, warnings: referenceWarnings(metrics) }
  } finally {
    bitmap.close()
  }
}
