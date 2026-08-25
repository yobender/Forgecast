import { Check } from 'lucide-react'
import { STAGES } from '../lib/presets'
import type { GenerationStage } from '../types'

const stageIndex = (stage: GenerationStage) => {
  if (stage === 'idle') return -1
  return STAGES.findIndex((entry) => entry.key === stage)
}

export function StageRail({ stage }: { stage: GenerationStage }) {
  const current = stageIndex(stage)

  return (
    <div className="stage-rail" aria-label="Generation progress">
      {STAGES.map((entry, index) => {
        const complete = current > index || stage === 'complete'
        const active = current === index && stage !== 'complete'
        return (
          <div className={`stage ${complete ? 'stage--complete' : ''} ${active ? 'stage--active' : ''}`} key={entry.key}>
            <span className="stage__dot">{complete ? <Check size={11} strokeWidth={3} /> : index + 1}</span>
            <span>{entry.label}</span>
          </div>
        )
      })}
    </div>
  )
}
