import { ensureXerces } from './xerces.mjs'
const dir = await ensureXerces()
console.log(`Xerces-J 2.12.2 (XSD 1.1): ${dir}`)
