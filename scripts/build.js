const { buildSource, getPlugins } = require('./lib/buildSource')
const { tar } = require('./lib/compress')

async function build() {
    await buildSource(false)
    const plugins = await getPlugins()

    await Promise.all(plugins.map(tar))
}

build()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    })
