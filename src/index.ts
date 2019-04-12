import * as tsserver from 'typescript/lib/tsserverlibrary'
import { I18nPlugin } from './plugin'

export = (mod: { typescript: typeof tsserver }) =>
  new I18nPlugin(mod.typescript)
