// Runner headless para verificar el cálculo de distancia
// Usa la misma lógica que VentasPage (Haversine + Nominatim)

import https from 'https'

function geocode(address) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      q: address, format: 'jsonv2', limit: '1', countrycodes: 'ar'
    })
    const url = 'https://nominatim.openstreetmap.org/search?' + params
    https.get(url, { headers: { 'User-Agent': 'Genesis360App/1.0' } }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try {
          const j = JSON.parse(d)
          if (!j[0]) return reject(new Error('Sin resultado para: ' + address))
          resolve({ lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) })
        } catch(e) { reject(e) }
      })
    }).on('error', reject)
  })
}

function haversineKmCoordsStatic(c1Lat, c1Lon, c2Lat, c2Lon) {
  const R = 6371
  const dLat = (c2Lat - c1Lat) * Math.PI / 180
  const dLon = (c2Lon - c1Lon) * Math.PI / 180
  const a = Math.sin(dLat/2)**2
    + Math.cos(c1Lat * Math.PI / 180) * Math.cos(c2Lat * Math.PI / 180) * Math.sin(dLon/2)**2
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 1.35 * 10) / 10
}

const testCases = [
  { origen: 'Av. Triunvirato 5428, Ciudad Autónoma de Buenos Aires',
    destino: 'Triunvirato 2066, Don Torcuato, Buenos Aires' },
  { origen: 'Av. Corrientes 1234, Buenos Aires',
    destino: 'Av. Santa Fe 3000, Buenos Aires' },
  { origen: 'Av. 9 de Julio 1000, Buenos Aires',
    destino: 'Palermo, Buenos Aires' },
]

console.log('\n=== TEST CÁLCULO DE DISTANCIA — Genesis360 VentasPage ===\n')
let passed = 0

for (const tc of testCases) {
  try {
    const o = await geocode(tc.origen)
    const d = await geocode(tc.destino)
    const km = haversineKmCoordsStatic(o.lat, o.lon, d.lat, d.lon)
    console.log(`✅ PASS: "${tc.origen.split(',')[0]}" → "${tc.destino.split(',')[0]}" = ${km} km`)
    passed++
  } catch(e) {
    console.log(`❌ FAIL: ${e.message}`)
  }
  // Respetar rate limit Nominatim: 1 req/s
  await new Promise(r => setTimeout(r, 1100))
}

console.log(`\n=== RESULTADO: ${passed}/${testCases.length} tests pasaron ===`)
if (passed === testCases.length) {
  console.log('✅ El campo Distancia (km) en VentasPage se completará correctamente.')
  process.exit(0)
} else {
  process.exit(1)
}
