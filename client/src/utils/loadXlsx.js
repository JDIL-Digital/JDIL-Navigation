// Lazily loads SheetJS (xlsx) from its CDN the first time a bulk upload happens.
// Avoids bundling a large parser into the main app for a rarely-used admin feature.
// Handles both .xlsx/.xls and .csv files.

const CDN_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'

let loadPromise = null

export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX)
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CDN_URL
    script.async = true
    script.onload = () => {
      if (window.XLSX) resolve(window.XLSX)
      else reject(new Error('SheetJS failed to initialise'))
    }
    script.onerror = () => {
      loadPromise = null
      reject(new Error('Could not load the spreadsheet parser (check your internet connection)'))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}

/**
 * Parses an Excel/CSV File into an array of row objects keyed by header.
 * @param {File} file
 * @returns {Promise<object[]>}
 */
export async function parseSpreadsheet(file) {
  const XLSX = await loadXlsx()
  const buf  = await file.arrayBuffer()
  const wb   = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  // defval:'' ensures empty cells become '' not undefined
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}
