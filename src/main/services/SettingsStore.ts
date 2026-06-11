import Store from 'electron-store'

const store = new Store({
  name: 'image-collection-v2-settings',
  defaults: {
    sources: [],
    activeSourceId: '',
    theme: 'dark',
    lang: 'en'
  }
})

export function getSetting(key: string): unknown {
  return store.get(key)
}

export function setSetting(key: string, value: unknown): void {
  store.set(key, value)
}
