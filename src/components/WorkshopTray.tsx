import { useEffect, useId, useState } from 'react'
import { Box, Check, ChevronDown } from 'lucide-react'

export interface WorkshopCandidate {
  recordId: string
  index: number
  seed: number
  modelUrl: string
  modelBytes?: number
  engine: string
  triangles: number
  thumbnail?: string
}

interface WorkshopTrayProps {
  candidates: WorkshopCandidate[]
  viewedId: string | null
  masterId?: string
  onSelect: (candidate: WorkshopCandidate) => void
  onApprove: () => void
}

export function WorkshopTray({ candidates, viewedId, masterId, onSelect, onApprove }: WorkshopTrayProps) {
  const [expanded, setExpanded] = useState(!masterId)
  const contentId = useId()
  const viewed = candidates.find((candidate) => candidate.recordId === viewedId)
  const master = candidates.find((candidate) => candidate.recordId === masterId)

  useEffect(() => { setExpanded(!masterId) }, [masterId])

  return <section className="candidate-comparison" aria-label="Quality Workshop comparison">
    <div className="candidate-comparison__heading">
      <div className="candidate-comparison__title">
        <strong>Shape comparison <span>{candidates.length} saved</span></strong>
        <small role="status">{viewed ? `Viewing Candidate ${viewed.index}` : 'Viewing another library asset'}{master ? ` · Master: Candidate ${master.index}` : ' · Choose one to keep as master'}</small>
      </div>
      <div className="candidate-comparison__actions">
        {master && viewedId !== masterId && <button className="tool-button" type="button" onClick={() => onSelect(master)}>View master</button>}
        <button className="tool-button" type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Hide comparison' : 'Compare versions'}<ChevronDown size={14} className={expanded ? 'chevron-up' : ''} />
        </button>
      </div>
    </div>
    <div className="candidate-comparison__body" id={contentId} hidden={!expanded}>
      <p className="candidate-explanation">Same reference, same detail setting, different random seeds. These are alternative shapes—not successive detail upgrades. Differences may be small.</p>
      <div className="candidate-grid">
        {candidates.map((candidate) => <button type="button" className={viewedId === candidate.recordId ? 'active' : ''} aria-pressed={viewedId === candidate.recordId} key={candidate.recordId} onClick={() => onSelect(candidate)}>
          <span className="candidate-thumb">{candidate.thumbnail ? <img src={candidate.thumbnail} alt="" /> : <Box size={24} />}</span>
          <span className="candidate-copy"><strong>Candidate {candidate.index}</strong><small>Seed {candidate.seed}</small><small>{candidate.modelBytes ? `${(candidate.modelBytes / 1024 ** 2).toFixed(1)} MB` : 'Saved mesh'}</small><span className="candidate-state">{masterId === candidate.recordId ? 'Saved master' : viewedId === candidate.recordId ? 'Viewing' : 'Click to inspect'}</span></span>
        </button>)}
      </div>
      <div className="candidate-comparison__footer">
        <small>Switch versions, then orbit or use Wireframe to compare edges, gaps and shape.</small>
        {master ? <span className="master-confirmation"><Check size={13} /> All versions remain in Saved casts.</span> : <button className="master-button" type="button" disabled={!viewed} onClick={onApprove}><Check size={14} /> {viewed ? `Keep Candidate ${viewed.index} as master` : 'Select a candidate'}</button>}
      </div>
    </div>
  </section>
}
