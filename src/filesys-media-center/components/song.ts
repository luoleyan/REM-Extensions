import { Provider } from 'extension/protocol/common/provider'
import { songEncodeDecoder } from 'extension/protocol/common/struct/audioTrack'
import { registerProvider } from 'extension/protocol/node/provider'
import { ProviderDescritpor } from 'extension/protocol/common/provider'

const providerDescritpor: ProviderDescritpor = {
    category: 'provider.song',
    name: 'fsMediaCenter.songs',
}

class SongProvider implements Provider {
    async read(uri: string): Promise<Buffer> {
        console.log('read', uri)
        return Buffer.alloc(0)
    }
    async write(uri: string, value: Buffer): Promise<void> {
        console.log('write', uri, songEncodeDecoder.decode(value))
    }
    async delete(uri: string): Promise<void> {
        console.log('delete', uri)
    }
}

registerProvider(
    providerDescritpor,
    new SongProvider()
)
