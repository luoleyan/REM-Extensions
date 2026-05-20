const { buildSource } = require('./lib/buildSource')
const { getAppDataPath } = require('appdata-path')
const { join } = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const index = require('../index.json')

const remPath = (...paths) => {
    return join(getAppDataPath('rem'), ...paths)
}

async function buildSourceAndSyncFiles() {
    const targets = process.argv.length > 2
        ? process.argv.slice(2)
        : index

    await buildSource(false, targets)

    const { default: cpy } = await import('cpy')
    const EXTENSION_ROOT = remPath('Data', 'Extensions')

    await Promise.all(targets.map(async dest => {
        const source = join(__dirname, '../build', dest)
        const destPath = join(EXTENSION_ROOT, dest)

        if (!fs.existsSync(source)) {
            console.warn(`Skip sync: build output missing for ${dest}`)
            return
        }

        if (fs.existsSync(destPath)) {
            await fsp.rm(destPath, { recursive: true })
        }

        await cpy(`${source}/**`, destPath)
        console.log(`Synced ${dest} -> ${destPath}`)
    }))
}

buildSourceAndSyncFiles().catch(err => {
    console.error(err)
    process.exit(1)
})
