const typescript = require('@rollup/plugin-typescript')
const { nodeResolve } = require('@rollup/plugin-node-resolve')
const commonjs = require('@rollup/plugin-commonjs')
const fs = require('fs/promises')
const path = require('path')
const { rollup } = require('rollup')
const Bundler = require('parcel-bundler')
const { existsSync } = require('fs')
const { execSync } = require('child_process')
const { rewritePlugin } = require('./rewrite-import')
const { inlineTslib } = require('./inline-tslib')

const extensionExternal = [ /extension.*/ ]

function isRuntimeDependency(id) {
    return !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('node:')
}

function cjsRollupPlugins(tsOptions) {
    return [
        typescript(tsOptions),
        nodeResolve({ preferBuiltins: true }),
        commonjs(),
        inlineTslib(),
    ]
}

function rollupExternal(id) {
    return extensionExternal.some(pattern => pattern.test(id)) || isRuntimeDependency(id)
}

async function installExtensionDependencies(src) {
    const pkgPath = path.join(src, 'package.json')
    if (!existsSync(pkgPath)) {
        return
    }

    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
    if (!pkg.dependencies || !Object.keys(pkg.dependencies).length) {
        return
    }

    console.log(`Installing dependencies for ${path.basename(src)}...`)
    execSync('npm install --omit=dev', {
        cwd: src,
        stdio: 'inherit',
    })

    await rebuildNativeModules(src, pkg)
}

function getElectronVersion() {
    const remPkgPath = path.join(__dirname, '../../../REM/package.json')
    const extPkgPath = path.join(__dirname, '../../package.json')

    for (const pkgPath of [ remPkgPath, extPkgPath ]) {
        if (!existsSync(pkgPath)) {
            continue
        }

        const pkg = require(pkgPath)
        const version = pkg.devDependencies?.electron || pkg.dependencies?.electron
        if (version) {
            return version.replace(/^[^\d]*/, '')
        }
    }

    return null
}

async function rebuildNativeModules(src, pkg) {
    const nativePackages = Object.keys(pkg.dependencies).filter(name =>
        [ 'audify' ].includes(name)
    )

    if (!nativePackages.length || !existsSync(path.join(src, 'node_modules'))) {
        return
    }

    const electronVersion = getElectronVersion()
    if (!electronVersion) {
        console.warn(`Skip native rebuild for ${path.basename(src)}: electron version not found`)
        return
    }

    console.log(`Rebuilding native modules for ${path.basename(src)} (electron ${electronVersion})...`)
    execSync(
        `npx --yes @electron/rebuild -v ${electronVersion} -w ${nativePackages.join(',')} -f`,
        { cwd: src, stdio: 'inherit' },
    )
}

async function getManifest(folder) {
    return JSON.parse(
        await fs.readFile(path.join(folder, 'manifest.json'))
    )
}

const requires = [
    'name', 'ver', 'components', 'id'
]

function checkRequires(manifest) {
    const keys = Object.keys(manifest)
    if (new Set(keys.concat(requires)).size !== keys.length) {
        throw new Error('Manifest is missing required fields')
    }

    if (typeof manifest.name !== 'string') {
        throw new Error('Manifest name is not a string')
    }

    if (typeof manifest.ver !== 'string') {
        throw new Error('Manifest version is not a string')
    }

    if (!Array.isArray(manifest.components)) {
        throw new Error('Manifest components is not an string array')
    }

    if (typeof manifest.id !== 'string') {
        throw new Error('Manifest id is not a string')
    }
}

let plugins
async function getPlugins() {
    if (plugins) {
        return plugins
    }
    return plugins = JSON.parse(await fs.readFile(path.join(__dirname, '../../index.json')))
}

function getPath(filename) {
    if (existsSync(filename)) {
        return filename
    }

    const tsPath = filename.replace('.js', '.ts')
    if (existsSync(tsPath)) {
        return tsPath
    }

    return filename
}

const tsconfigEsm = {
    compilerOptions: {
        module: "ESNext"
    }
}

async function tasks(sourcemap=true, pluginFilter=null) {
    const cpy = await import('cpy')

    /**@type {any[]}*/
    const plugins = await getPlugins()
    const tasks = []
    for (const plugin of plugins) {
        if (pluginFilter?.length && !pluginFilter.includes(plugin)) {
            continue
        }
        const src = path.join(__dirname, '../../src', plugin)
        const manifest = await getManifest(src)

        checkRequires(manifest)
        
        const buildDest = path.join(__dirname, '../../build', plugin)
        const { entry, uiEntry, settings, windows, components, threads } = manifest

        await fs.rm(buildDest, { recursive: true, force: true })
        await cpy.default([src + '/**/*.json'], buildDest)
        await installExtensionDependencies(src)
        if (existsSync(path.join(src, 'node_modules'))) {
            await cpy.default([src + '/node_modules/**/*'], path.join(buildDest, 'node_modules'))
        }

        if (threads) {
            for (const filePath of Object.values(threads)) {
                tasks.push({
                    input: getPath(path.join(src, filePath)),
                    external: rollupExternal,
                    output: {
                        file: path.join(buildDest, `${filePath}`),
                        format: 'cjs',
                        sourcemap
                    },
                    plugins: cjsRollupPlugins(),
                })
            }
        }

        if (entry) {
            tasks.push({
                input: getPath(path.join(src, entry)),
                external: rollupExternal,
                output: {
                    file: path.join(buildDest, `${entry}`),
                    format: 'cjs',
                    sourcemap
                },
                plugins: cjsRollupPlugins(),
            })
        }

        if (uiEntry) {
            tasks.push({
                input: getPath(path.join(src, uiEntry)),
                external: [ /extension.*/ ],
                output: {
                    file: path.join(buildDest, uiEntry),
                    format: 'esm',
                    sourcemap
                },
                plugins: [
                    typescript(tsconfigEsm),
                    rewritePlugin(buildDest, uiEntry)
                ],
            })
        }

        if (settings) {
            tasks.push({
                input: getPath(path.join(src, settings)),
                external: [ /extension.*/ ],
                output: {
                    file: path.join(buildDest, settings),
                    format: 'esm',
                    sourcemap
                },
                plugins: [
                    typescript(tsconfigEsm),
                    rewritePlugin(buildDest, settings)
                ],
            })
        }

        if (windows) {
            if (!components.includes('new_window')) {
                console.warn(`Did you forget to add 'new_window' to the components?`)
            } else {
                for (const [ _, { main, renderer } ] of Object.entries(windows)) {
                    main && tasks.push({
                        input: getPath(path.join(src, main)),
                        external: rollupExternal,
                        output: {
                            file: path.join(buildDest, `${main}`),
                            format: 'cjs',
                            sourcemap
                        },
                        plugins: cjsRollupPlugins(),
                    })

                    const name = path.basename(renderer)
                    const dir = path.dirname(renderer)

                    const bundler = new Bundler([ path.join(src, renderer) ], {
                        logLevel: 3,
                        watch: false,
                        outDir: path.join(buildDest, dir),
                        outFile: name,
                        cache: false,
                        hmr: false,
                        autoInstall: false,
                        target: 'electron',
                        sourceMaps: sourcemap,
                        publicUrl: './',
                    })

                    await bundler.bundle()
                }
            }
        }
    }

    return tasks
}

/**
 * @param {boolean} sourcemap 
 * @param {(done: number, total: number) => void} cb 
 */
async function buildSource(sourcemap=true, pluginFilter=null, cb=Function.prototype) {
    let i = 0
    const _tasks = await tasks(sourcemap, pluginFilter)
    for (const task of _tasks) {
        const build = await rollup(task)
        await build.write(task.output)
        build.close()
        cb.call(undefined, ++i, _tasks.length)
    }
}

module.exports = {
    tasks, buildSource, getPlugins,
}