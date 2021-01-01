import fetch from 'node-fetch'
import { parseStats } from '../../server/src/parse'
import { version } from '../package.json'

// Adapted from:
// https://raw.githubusercontent.com/FormidableLabs/webpack-stats-plugin/main/lib/stats-writer-plugin.js

interface Options {
    host: string
    uploadStats: boolean
}

/**
 * Bundle Tracker Plugin
 *
 * @param {Object}     opts                options
 * @param {Boolean}    opts.uploadStats    whether to upload the bundle (default true if NODE_ENV === "production")
 * @param {String}     opts.host           host to upload to (default: `"https://app.bundletracker.io"`)
 *
 * @api public
 */
export class BundleTrackerPlugin {
    opts: Options

    constructor(opts: Partial<Options> = {}) {
        this.opts = {
            uploadStats:
                typeof opts.uploadStats === 'undefined' ? process.env.NODE_ENV === 'production' : opts.uploadStats,
            host: opts.host || 'https://app.bundletracker.io',
        }
    }

    apply(compiler: any) {
        if (compiler.hooks) {
            let emitHookSet = false

            // Capture the compilation and then set up further hooks.
            compiler.hooks.thisCompilation.tap('stats-writer-plugin', (compilation: any) => {
                if (compilation.hooks.processAssets) {
                    // Modern: `processAssets` is one of the last hooks before frozen assets.
                    // We choose `PROCESS_ASSETS_STAGE_REPORT` which is the last possible
                    // stage after which to emit.
                    //
                    // See:
                    // - https://webpack.js.org/api/compilation-hooks/#processassets
                    // - https://github.com/FormidableLabs/webpack-stats-plugin/issues/56
                    compilation.hooks.processAssets.tapPromise(
                        {
                            name: 'stats-writer-plugin',
                            stage: compilation.constructor.PROCESS_ASSETS_STAGE_REPORT,
                        },
                        () => this.emitStats(compilation)
                    )
                } else if (!emitHookSet) {
                    // Legacy.
                    //
                    // Set up the `compiler` level hook only once to avoid multiple
                    // calls during `webpack --watch`. (We have to do this here because
                    // we can't otherwise detect if `compilation.hooks.processAssets` is
                    // available for modern mode.)
                    emitHookSet = true
                    compiler.hooks.emit.tapPromise('stats-writer-plugin', this.emitStats.bind(this))
                }
            })
        } else {
            // Super-legacy.
            compiler.plugin('emit', this.emitStats.bind(this))
        }
    }

    emitStats(curCompiler: any, callback?: any) {
        if (!this.opts.uploadStats) {
            return
        }
        let stats = curCompiler.getStats().toJson()

        // Transform to string.
        let err
        return Promise.resolve()
            .then(() => {
                const tree = parseStats(stats)
                const meta = {
                    pluginVersion: version,
                    webpackVersion: stats.version,
                    hash: stats.hash,
                }

                const url = `${this.opts.host}/upload`

                try {
                    fetch(url, {
                        method: 'POST',
                        body: JSON.stringify({ tree, meta }),
                        headers: { 'Content-Type': 'application/json' },
                    })
                        .then((res) => res.json())
                        .then((res) => {
                            if (res.message) {
                                console.log(res.message)
                            } else {
                                console.log(res)
                            }
                        })
                } catch (error) {
                    console.error('🔴 Error uploading stats to BundleTracker')
                    console.error(error)
                }
            })
            .catch((e) => {
                err = e
            })
            .then(() => {
                if (callback) {
                    return void callback()
                }
            })
    }
}
