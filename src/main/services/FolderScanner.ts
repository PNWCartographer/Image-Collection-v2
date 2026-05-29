import { readdir } from 'fs/promises'
import { join } from 'path'
import type { FolderScanResult } from '../../shared/types'

const ALWAYS_SKIP = new Set(['#recycle', '$recycle.bin', '.', '..'])

export async function scanRootFolder(rootPath: string): Promise<FolderScanResult> {
  const entries = await readdir(rootPath, { withFileTypes: true })
  const folders = entries
    .filter((entry) => entry.isDirectory() && !ALWAYS_SKIP.has(entry.name.toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      path: join(rootPath, entry.name),
      isMachineFolder: /^M\d+$/i.test(entry.name)
    }))
    .sort((a, b) => {
      if (a.isMachineFolder && !b.isMachineFolder) return -1
      if (!a.isMachineFolder && b.isMachineFolder) return 1
      if (a.isMachineFolder && b.isMachineFolder) {
        const numA = parseInt(a.name.slice(1), 10)
        const numB = parseInt(b.name.slice(1), 10)
        return numA - numB
      }
      return a.name.localeCompare(b.name)
    })

  return { rootPath, folders }
}
