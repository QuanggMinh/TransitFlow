import path from 'path'
import dotenv from 'dotenv'

const serverRoot = path.resolve(__dirname, '..', '..')

// Local credentials override the shared environment without being committed.
dotenv.config({ path: path.join(serverRoot, '.env.local') })
dotenv.config({ path: path.join(serverRoot, '.env') })
