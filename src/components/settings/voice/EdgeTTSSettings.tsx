import { useTranslation } from 'react-i18next'

import settingsStore from '@/features/stores/settings'
import { Link } from '../../link'
import { settingsControlClass } from '@/components/settings/formStyles'

interface EdgeTTSSettingsProps {
  edgeTtsVoice: string
}

export const EdgeTTSSettings = ({ edgeTtsVoice }: EdgeTTSSettingsProps) => {
  const { t } = useTranslation()

  return (
    <>
      <div className="my-2 text-sm whitespace-pre-wrap">
        {t('EdgeTTSInfo')}
        <br />
        <Link
          url="https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts"
          label="https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts"
        />
      </div>
      <div className="mt-4 font-bold">{t('EdgeTTSVoiceName')}</div>
      <div className="mt-2">
        <input
          className={settingsControlClass.medium}
          type="text"
          placeholder="zh-CN-XiaoxiaoNeural"
          value={edgeTtsVoice}
          onChange={(e) =>
            settingsStore.setState({ edgeTtsVoice: e.target.value })
          }
        />
      </div>
    </>
  )
}
