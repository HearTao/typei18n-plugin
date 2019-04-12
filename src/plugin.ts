import * as tsserver from 'typescript/lib/tsserverlibrary'
import { gen, Target } from 'typei18n'
import * as yaml from 'yaml'
import * as path from 'path'

interface BaseOptions {
  locales: string
  filePath: string
  moduleName: string
  lazy?: boolean
}

interface NormalOptions extends BaseOptions {
  lazy?: false
}

interface LazyOptions extends BaseOptions {
  lazy: true
  defaultLanguage: string
}

type Options = NormalOptions | LazyOptions

export class I18nPlugin {
  private logger: tsserver.server.Logger | null = null
  private watchers: tsserver.FileWatcher[] = []
  private host: tsserver.LanguageServiceHost | null = null
  private info: tsserver.server.PluginCreateInfo | null = null
  private options: Options | null = null

  public constructor(private readonly typescript: typeof tsserver) {}

  public create(info: tsserver.server.PluginCreateInfo) {
    this.info = info
    this.host = info.languageServiceHost
    const logger = (this.logger = info.project.projectService.logger)

    const options = (this.options = (info.config.options || {}) as Options)

    if (!this.validOptions(options)) {
      return info.languageService
    }
    logger.info('create plugin: ' + JSON.stringify(info.config.options))

    this.hookResolveModule()

    return info.languageService
  }

  public onConfigurationChanged(config: any) {
    this.logger && this.logger.info('config changed')

    if (!this.validOptions(config.options)) {
      return
    }
    this.options = config.options
    this.hookResolveModule()
    this.write()
  }

  private validOptions(options: Options) {
    const { logger, host } = this
    if (host && host.readDirectory) {
      if (!options.moduleName || !options.filePath || !options.locales) {
        logger &&
          logger.info(
            `invalid options: options is required, but: ${JSON.stringify(
              options
            )}`
          )
        return false
      }

      const files = host.readDirectory(
        path.resolve(host.getCurrentDirectory(), options.locales),
        ['.yaml']
      )
      if (!files.length) {
        logger && logger.info('invalid options: no yaml files')
        return false
      }
      return true
    }
    return false
  }

  private hookResolveModule() {
    const { info, logger, options, host } = this

    if (!info || !options || !host) return

    if (info.languageServiceHost.resolveModuleNames) {
      const _resolveModuleNames = info.languageServiceHost.resolveModuleNames.bind(
        info.languageServiceHost
      )

      logger && logger.info('hook resolve module')
      logger && logger.info('current dir: ' + host.getCurrentDirectory())

      info.languageServiceHost.resolveModuleNames = (
        moduleNames,
        containingFile,
        reusedNames
      ) => {
        const resolvedModules = _resolveModuleNames(
          moduleNames,
          containingFile,
          reusedNames
        )

        return moduleNames.map((moduleName, index) => {
          if (moduleName === options.moduleName) {
            logger && logger.info(`resolve module: ${moduleName}`)

            const locales = path.resolve(
              host.getCurrentDirectory(),
              options.locales
            )
            if (
              host.directoryExists &&
              host.readDirectory &&
              host.directoryExists(locales)
            ) {
              this.write()
              if (this.watchers.length) {
                logger && logger.info(`close file watchers`)
                this.watchers.forEach(x => x.close())
                this.watchers = []
              }

              const files = host.readDirectory(locales, ['.yaml'])
              logger && logger.info(`watch files`)
              this.watchers = files.map(file =>
                info.serverHost.watchFile(file, () => this.write())
              )
              logger && logger.info(`watched ${this.watchers.length} files`)

              return {
                isExternalLibraryImport: false,
                resolvedFileName: path.resolve(
                  host.getCurrentDirectory(),
                  options.filePath
                )
              }
            }
          }
          return resolvedModules[index]
        })
      }
    }
  }

  private write() {
    const { options, host, logger } = this
    if (
      options &&
      host &&
      host.readDirectory &&
      host.readFile &&
      host.writeFile
    ) {
      const locales = path.resolve(host.getCurrentDirectory(), options.locales)
      const filePath = path.resolve(
        host.getCurrentDirectory(),
        options.filePath
      )

      const readFile = host.readFile.bind(host)
      const files = host.readDirectory(locales, ['.yaml']).map(x => ({
        name: path.basename(x, '.yaml'),
        value: yaml.parse(readFile(x)!)
      }))
      logger && logger.info(`write file: ${filePath}`)

      try {
        const code = options.lazy
          ? gen(files, Target.type, true, options.defaultLanguage)[0]
          : gen(files, Target.type)
        host.writeFile(filePath, code)
        logger && logger.info(`write file succeed: ${filePath}`)
      } catch (e) {
        logger && logger.info(`write file failed: ${JSON.stringify(e)}`)
        return
      }
    }
  }
}
