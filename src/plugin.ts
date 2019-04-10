import * as tsserver from "typescript/lib/tsserverlibrary";
import * as mockRequire from "mock-require"
import { gen, Target } from "typei18n";

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
  private host: tsserver.server.ServerHost | null = null
  private info: tsserver.server.PluginCreateInfo | null = null
  private options: Options | null = null
  private hooked: boolean = false

  public constructor(private readonly typescript: typeof tsserver) {
    mockRequire("typescript", typescript);
  }

  public create(info: tsserver.server.PluginCreateInfo) {
    this.info = info
    this.host = info.serverHost
    const logger = this.logger = info.project.projectService.logger
    const options = this.options = (info.config.options || {}) as Options

    if (!this.validOptions(options)) {
      return info.languageService
    }
    logger.info('create plugin: ' + JSON.stringify(info.config.options));

    this.hookResolveModule()

    return info.languageService;
  }

  public onConfigurationChanged(config: any) {
    this.logger && this.logger.info('config changed');

    if (!this.validOptions(config.options)) {
      return
    }
    this.options = config.options
    this.hookResolveModule()
    this.write()
  }

  private validOptions(options: Options) {
    const { logger, host } = this
    if (host) {
      if (!options.moduleName || !options.filePath || !options.locales) {
        logger && logger.info(`invalid options: options is required, but: ${JSON.stringify(options)}`)
        return false
      }

      const files = host.readDirectory(options.locales, ['.yaml'])
      if (!files.length) {
        logger && logger.info('invalid options: no yaml files');
        return false
      }
      return true
    }
    return false
  }

  private hookResolveModule() {
    const { info, logger, options, host, hooked } = this

    if (!info || !options || !host || hooked) return
    this.hooked = true

    if (info.languageServiceHost.resolveModuleNames) {
      const _resolveModuleNames = info.languageServiceHost.resolveModuleNames.bind(info.languageServiceHost);

      logger && logger.info('hook resolve module');
      info.languageServiceHost.resolveModuleNames = (moduleNames, containingFile, reusedNames) => {
        const resolvedModules = _resolveModuleNames(moduleNames, containingFile, reusedNames)

        return moduleNames.map((moduleName, index) => {
          if (moduleName === options.moduleName) {
            logger && logger.info(`resolve module: ${moduleName}`)

            if (host.directoryExists(options.locales)) {

              this.write()
              if (this.watchers.length) {
                logger && logger.info(`close file watchers`)
                this.watchers.forEach(x => x.close())
                this.watchers = []
              }

              const files = host.readDirectory(options.locales, ['.yaml'])
              logger && logger.info(`watch files`)
              this.watchers = files.map(file => info.serverHost.watchFile(file, () => this.write()))
              logger && logger.info(`watched ${this.watchers.length} files`)

              return {
                isExternalLibraryImport: false,
                resolvedFileName: options.filePath,
              }
            }
          }
          return resolvedModules[index];
        });
      };
    }
  }

  private write() {
    const { options, host, logger } = this
    if (options && host) {
      const files = host.readDirectory(options.locales, ['.yaml'])
      logger && logger.info(`write file: ${options.filePath}`)

      try {
        const code = options.lazy ? gen(files, Target.type, true, options.defaultLanguage)[0] : gen(files, Target.type)
        host.writeFile(options.filePath, code)
        logger && logger.info(`write file succeed: ${options.filePath}`)
      } catch (e) {
        logger && logger.info(`write file failed: ${JSON.stringify(e)}`)
        return
      }
    }
  }
}