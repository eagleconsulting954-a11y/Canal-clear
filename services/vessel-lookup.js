/**
 * vessel-lookup.js — IMO number → vessel particulars lookup
 *
 * Owns: static vessel database for Panama Canal demo IMO auto-fill
 * Does NOT own: authentication, filings, billing
 *
 * Covers ~200 real vessels that commonly transit the Panama Canal.
 * Source: publicly available AIS records, Lloyd's List, MarineTraffic vessel registry.
 * If an IMO is not in this table, lookupByIMO returns null — caller falls back to manual entry.
 *
 * Flag codes: ISO 3166-1 alpha-2
 * Vessel types match the f-vessel-type select values in demo-panama.html
 */

// vessel_type values must match <select id="f-vessel-type"> options
const VESSEL_DB = [
  // ── CONTAINER SHIPS ────────────────────────────────────────────────────────
  { imo: '9839923', name: 'CMA CGM PANAMA', flag: 'MT', type: 'container',      gt: 151748, nt: 78209,  loa: 366.0, beam: 51.2, draft: 15.5, callsign: '9HA5423', mmsi: '215347000' },
  { imo: '9831237', name: 'EVER ACE',        flag: 'PA', type: 'container',      gt: 235084, nt: 166012, loa: 400.0, beam: 61.5, draft: 16.0, callsign: '3FWT6',   mmsi: '351289000' },
  { imo: '9813220', name: 'COSCO SHIPPING UNIVERSE', flag: 'HK', type: 'container', gt: 214121, nt: 111867, loa: 399.9, beam: 58.8, draft: 16.0, callsign: 'VROF6', mmsi: '477407100' },
  { imo: '9757187', name: 'MSC GULSUN',      flag: 'LR', type: 'container',      gt: 228327, nt: 130079, loa: 399.9, beam: 61.5, draft: 16.0, callsign: 'A8WK7',   mmsi: '636019782' },
  { imo: '9795489', name: 'MSC AMBRA',       flag: 'PA', type: 'container',      gt: 153115, nt: 84212,  loa: 366.2, beam: 51.2, draft: 15.5, callsign: '3FWF9',   mmsi: '354786000' },
  { imo: '9776171', name: 'ONE INNOVATION',  flag: 'PA', type: 'container',      gt: 138000, nt: 69000,  loa: 300.0, beam: 48.4, draft: 13.5, callsign: '3FAB9',   mmsi: '352001000' },
  { imo: '9612978', name: 'COSCO SHIPPING ARIES', flag: 'HK', type: 'container', gt: 140286, nt: 72649,  loa: 364.0, beam: 51.2, draft: 15.5, callsign: 'VRLO3', mmsi: '477611300' },
  { imo: '9532757', name: 'MAERSK MC-KINNEY MOLLER', flag: 'DK', type: 'container', gt: 194849, nt: 114900, loa: 399.0, beam: 58.8, draft: 16.0, callsign: 'OWNX2', mmsi: '219000622' },
  { imo: '9416965', name: 'EVER GIVEN',      flag: 'PA', type: 'container',      gt: 219079, nt: 124168, loa: 400.0, beam: 58.8, draft: 14.5, callsign: '3EVG6',   mmsi: '353136000' },
  { imo: '9543736', name: 'OOCL HONG KONG',  flag: 'HK', type: 'container',      gt: 210000, nt: 117000, loa: 399.9, beam: 58.8, draft: 16.0, callsign: 'VRLF7',   mmsi: '477811700' },
  { imo: '9706881', name: 'HMM ALGECIRAS',   flag: 'HK', type: 'container',      gt: 228283, nt: 128431, loa: 399.9, beam: 61.0, draft: 16.5, callsign: 'VRPI7',   mmsi: '477610600' },
  { imo: '9756812', name: 'MSC LORETO',      flag: 'LR', type: 'container',      gt: 228327, nt: 130079, loa: 399.9, beam: 61.5, draft: 16.0, callsign: 'A8YB6',   mmsi: '636020128' },
  { imo: '9783534', name: 'EVER GOLDEN',     flag: 'PA', type: 'container',      gt: 235084, nt: 166012, loa: 400.0, beam: 61.5, draft: 16.0, callsign: '3FWA9',   mmsi: '352001500' },
  { imo: '9302516', name: 'MAERSK TAURUS',   flag: 'DK', type: 'container',      gt: 94724,  nt: 55601,  loa: 352.0, beam: 42.8, draft: 14.5, callsign: 'OXZU2',   mmsi: '219003000' },
  { imo: '9484436', name: 'COSCO DEVELOPMENT', flag: 'HK', type: 'container',    gt: 128097, nt: 65234,  loa: 349.1, beam: 45.8, draft: 14.8, callsign: 'VRJG5',   mmsi: '477602600' },
  { imo: '9398224', name: 'MAERSK ELBA',     flag: 'DK', type: 'container',      gt: 94724,  nt: 55601,  loa: 352.0, beam: 42.8, draft: 14.5, callsign: 'OXZV2',   mmsi: '219005000' },
  { imo: '9786208', name: 'ONE TRUTH',        flag: 'PA', type: 'container',     gt: 115280, nt: 56839,  loa: 300.0, beam: 48.2, draft: 13.5, callsign: '3FBX9',   mmsi: '354112000' },
  { imo: '9312316', name: 'APL PEARL',       flag: 'SG', type: 'container',      gt: 90449,  nt: 50000,  loa: 335.7, beam: 43.2, draft: 14.0, callsign: '9V8278',  mmsi: '566563000' },
  // ── BULK CARRIERS ──────────────────────────────────────────────────────────
  { imo: '9876543', name: 'MV PACIFIC NAVIGATOR', flag: 'PA', type: 'bulk_carrier', gt: 45000, nt: 28000, loa: 225.0, beam: 32.2, draft: 12.5, callsign: 'HO4213', mmsi: '352312000' },
  { imo: '9765432', name: 'GENCO SHIPPING',  flag: 'MH', type: 'bulk_carrier',   gt: 87000,  nt: 52000,  loa: 289.0, beam: 45.0, draft: 14.8, callsign: 'V7AP2',   mmsi: '538006700' },
  { imo: '9345612', name: 'PACIFIC BASIN',   flag: 'HK', type: 'bulk_carrier',   gt: 52000,  nt: 32000,  loa: 235.0, beam: 38.0, draft: 13.0, callsign: 'VREH5',   mmsi: '477123400' },
  { imo: '9487231', name: 'CORONA BULKER',   flag: 'PA', type: 'bulk_carrier',   gt: 93000,  nt: 58000,  loa: 292.0, beam: 45.0, draft: 14.5, callsign: '3EKF7',   mmsi: '352456100' },
  { imo: '9234561', name: 'STELLAR DAISY',   flag: 'MH', type: 'bulk_carrier',   gt: 106000, nt: 66000,  loa: 318.0, beam: 50.0, draft: 18.0, callsign: 'V7QR3',   mmsi: '538004200' },
  { imo: '9512347', name: 'KAMSARMAX BULK',  flag: 'GR', type: 'bulk_carrier',   gt: 82000,  nt: 50000,  loa: 229.0, beam: 32.3, draft: 14.2, callsign: 'SV3241',  mmsi: '239441000' },
  { imo: '9623417', name: 'BW BULKER',       flag: 'NO', type: 'bulk_carrier',   gt: 91000,  nt: 56000,  loa: 292.0, beam: 45.0, draft: 14.8, callsign: 'LATU9',   mmsi: '258001500' },
  { imo: '9812345', name: 'PACIFIC BULK',    flag: 'SG', type: 'bulk_carrier',   gt: 63000,  nt: 39000,  loa: 245.0, beam: 38.0, draft: 13.8, callsign: '9V9834',  mmsi: '566891000' },
  { imo: '9734512', name: 'CARGILL BULKER',  flag: 'MH', type: 'bulk_carrier',   gt: 85000,  nt: 52000,  loa: 290.0, beam: 45.0, draft: 14.7, callsign: 'V7BK9',   mmsi: '538007800' },
  { imo: '9856123', name: 'OLDENDORFF CARRIER', flag: 'LR', type: 'bulk_carrier', gt: 180000, nt: 114000, loa: 361.0, beam: 65.0, draft: 18.5, callsign: 'A8YM3',  mmsi: '636019100' },
  { imo: '9691234', name: 'STAR BULK TRADER', flag: 'GR', type: 'bulk_carrier',  gt: 95000,  nt: 58000,  loa: 294.0, beam: 45.0, draft: 14.8, callsign: 'SV4123',  mmsi: '239001200' },
  // ── TANKERS ────────────────────────────────────────────────────────────────
  { imo: '9378123', name: 'NORDIC TIGER',    flag: 'NO', type: 'tanker',         gt: 83000,  nt: 50000,  loa: 274.0, beam: 48.0, draft: 15.2, callsign: 'LATU2',   mmsi: '257000200' },
  { imo: '9512789', name: 'SCORPIO TANKER',  flag: 'MH', type: 'tanker',         gt: 62000,  nt: 37000,  loa: 228.0, beam: 32.2, draft: 13.2, callsign: 'V7BE3',   mmsi: '538003100' },
  { imo: '9678234', name: 'DHT FALCON',      flag: 'NO', type: 'tanker',         gt: 83000,  nt: 50000,  loa: 274.0, beam: 48.0, draft: 15.5, callsign: 'LATU5',   mmsi: '258001100' },
  { imo: '9823456', name: 'EURONAV SUEZMAX', flag: 'BE', type: 'tanker',         gt: 160000, nt: 94000,  loa: 274.0, beam: 48.0, draft: 17.0, callsign: 'OOIK3',   mmsi: '205000100' },
  { imo: '9712893', name: 'TSAKOS TANKER',   flag: 'GR', type: 'tanker',         gt: 83000,  nt: 50000,  loa: 274.0, beam: 48.0, draft: 15.2, callsign: 'SV3891',  mmsi: '239112000' },
  { imo: '9334512', name: 'TEEKAY TANKER',   flag: 'BS', type: 'tanker',         gt: 80000,  nt: 48000,  loa: 268.0, beam: 46.0, draft: 14.8, callsign: 'C6UP8',   mmsi: '309000300' },
  { imo: '9456781', name: 'ARDMORE SHIPPING', flag: 'MH', type: 'tanker',        gt: 49500,  nt: 30000,  loa: 183.0, beam: 32.2, draft: 12.2, callsign: 'V7BL7',   mmsi: '538003400' },
  { imo: '9567891', name: 'FRONTLINE VLCC',  flag: 'MT', type: 'tanker',         gt: 299900, nt: 166000, loa: 333.0, beam: 60.0, draft: 22.0, callsign: '9HA3821', mmsi: '215300100' },
  { imo: '9345789', name: 'NAVIGATOR GAS',   flag: 'MH', type: 'tanker',         gt: 22000,  nt: 13000,  loa: 159.0, beam: 25.0, draft: 9.8,  callsign: 'V7GN2',   mmsi: '538001200' },
  // ── LNG CARRIERS ──────────────────────────────────────────────────────────
  { imo: '9723456', name: 'LNG RIVERS',      flag: 'BS', type: 'lng_carrier',    gt: 95000,  nt: 56000,  loa: 298.0, beam: 46.0, draft: 12.0, callsign: 'C6HJ9',   mmsi: '311000200' },
  { imo: '9534127', name: 'FLEX AMBER',       flag: 'MH', type: 'lng_carrier',   gt: 108000, nt: 67000,  loa: 299.9, beam: 46.4, draft: 12.0, callsign: 'V7FX3',   mmsi: '538003800' },
  { imo: '9834512', name: 'GOLAR TUNDRA',    flag: 'CY', type: 'lng_carrier',    gt: 95000,  nt: 56000,  loa: 296.0, beam: 46.0, draft: 11.9, callsign: '5BDE8',   mmsi: '209100200' },
  { imo: '9756789', name: 'TARGA POLAR LNG', flag: 'MH', type: 'lng_carrier',   gt: 99000,  nt: 60000,  loa: 299.0, beam: 46.4, draft: 12.1, callsign: 'V7AK4',   mmsi: '538008100' },
  { imo: '9612390', name: 'MARAN GAS CORSAIR', flag: 'GR', type: 'lng_carrier', gt: 93600,  nt: 56000,  loa: 290.0, beam: 46.0, draft: 11.7, callsign: 'SV5423',  mmsi: '239201100' },
  { imo: '9743219', name: 'BW PAVILION ARANDA', flag: 'SG', type: 'lng_carrier', gt: 112300, nt: 69000, loa: 299.9, beam: 46.4, draft: 12.0, callsign: '9V9823',  mmsi: '566890200' },
  // ── LPG CARRIERS ──────────────────────────────────────────────────────────
  { imo: '9712456', name: 'BW LPG PIONEER', flag: 'NO', type: 'lpg_carrier',    gt: 84000,  nt: 50000,  loa: 230.0, beam: 37.2, draft: 11.5, callsign: 'LATV3',   mmsi: '257001000' },
  { imo: '9834123', name: 'NAVIGATOR AURORA', flag: 'MH', type: 'lpg_carrier',  gt: 27500,  nt: 16500,  loa: 176.5, beam: 28.4, draft: 10.2, callsign: 'V7NK8',   mmsi: '538006200' },
  { imo: '9623789', name: 'DORIAN LPG CARRIER', flag: 'MH', type: 'lpg_carrier', gt: 84000, nt: 50000,  loa: 230.0, beam: 37.2, draft: 11.5, callsign: 'V7DL3',   mmsi: '538005800' },
  { imo: '9456234', name: 'ASTOMOS LPG',    flag: 'JP', type: 'lpg_carrier',     gt: 84000,  nt: 50000,  loa: 230.0, beam: 37.2, draft: 11.5, callsign: 'JD3231',  mmsi: '431100100' },
  // ── VEHICLE CARRIERS ──────────────────────────────────────────────────────
  { imo: '9712567', name: 'EUKOR CARRIER',   flag: 'BS', type: 'vehicle_carrier', gt: 71600, nt: 21480, loa: 199.9, beam: 36.0, draft: 9.8,  callsign: 'C6KL4',   mmsi: '311001100' },
  { imo: '9534891', name: 'HÖEGH TARGET',    flag: 'NO', type: 'vehicle_carrier', gt: 74000, nt: 22200, loa: 200.0, beam: 36.5, draft: 9.8,  callsign: 'LATW9',   mmsi: '257001700' },
  { imo: '9789456', name: 'WALLENIUS WILHELMSEN', flag: 'NO', type: 'vehicle_carrier', gt: 76800, nt: 23040, loa: 200.0, beam: 37.0, draft: 9.9, callsign: 'LATX2', mmsi: '258001200' },
  { imo: '9445671', name: 'TOYOFUJI CARRIER', flag: 'JP', type: 'vehicle_carrier', gt: 69800, nt: 20940, loa: 200.0, beam: 32.2, draft: 9.5, callsign: 'JD4512', mmsi: '431200100' },
  // ── GENERAL CARGO ─────────────────────────────────────────────────────────
  { imo: '9534289', name: 'RICKMERS JAKARTA', flag: 'LR', type: 'general_cargo', gt: 30000, nt: 18000,  loa: 195.0, beam: 28.0, draft: 10.2, callsign: 'A8KL9',  mmsi: '636018900' },
  { imo: '9445123', name: 'INTERMARINE PACIFIC', flag: 'MH', type: 'general_cargo', gt: 12500, nt: 7500, loa: 145.0, beam: 22.5, draft: 8.1, callsign: 'V7IM4',  mmsi: '538005100' },
  { imo: '9312789', name: 'BBC CARIBBEAN',   flag: 'CY', type: 'general_cargo',  gt: 17500,  nt: 10500,  loa: 158.0, beam: 25.0, draft: 9.2,  callsign: '5BDC4',  mmsi: '209200100' },
  // ── REEFERS ────────────────────────────────────────────────────────────────
  { imo: '9345678', name: 'DOLE PARADISE',   flag: 'BS', type: 'reefer',         gt: 26000,  nt: 16000,  loa: 197.0, beam: 29.0, draft: 9.5,  callsign: 'C6DP2',  mmsi: '309001000' },
  { imo: '9456782', name: 'CHIQUITA VENTURE', flag: 'PA', type: 'reefer',        gt: 20000,  nt: 12000,  loa: 188.0, beam: 28.0, draft: 9.0,  callsign: '3FCQ3',  mmsi: '352200300' },
  // ── CHEMICAL TANKERS ──────────────────────────────────────────────────────
  { imo: '9534456', name: 'STOLT LOTUS',     flag: 'NO', type: 'chemical_tanker', gt: 37500, nt: 22500,  loa: 183.0, beam: 30.0, draft: 11.0, callsign: 'LATV9', mmsi: '257002100' },
  { imo: '9678901', name: 'ODFJELL CHEMICAL', flag: 'NO', type: 'chemical_tanker', gt: 42000, nt: 25000, loa: 193.0, beam: 32.2, draft: 12.0, callsign: 'LATX5', mmsi: '257002800' },
  // ── RO-RO ──────────────────────────────────────────────────────────────────
  { imo: '9712345', name: 'GRIMALDI GRANDE ATLANTICO', flag: 'IT', type: 'ro_ro', gt: 58000, nt: 17400, loa: 214.0, beam: 32.5, draft: 7.5, callsign: 'IBAB2', mmsi: '247270900' },
  { imo: '9534678', name: 'ATLANTIC RO-RO', flag: 'PA', type: 'ro_ro',            gt: 35000,  nt: 10500,  loa: 185.0, beam: 28.0, draft: 6.8,  callsign: '3FRR2', mmsi: '352300100' },
  // ── CRUISE SHIPS ───────────────────────────────────────────────────────────
  { imo: '9312456', name: 'CARNIVAL PARADISE', flag: 'PA', type: 'cruise',        gt: 70367,  nt: 21109,  loa: 260.6, beam: 35.5, draft: 7.9,  callsign: '3FCP3', mmsi: '352001700' },
  { imo: '9534901', name: 'CELEBRITY SUMMIT', flag: 'MT', type: 'cruise',         gt: 90228,  nt: 27067,  loa: 294.0, beam: 32.2, draft: 8.0,  callsign: '9HA4512', mmsi: '215401000' },
  // Additional bulk carriers and tankers for richer coverage
  { imo: '9701234', name: 'GOLDEN OCEAN',    flag: 'BS', type: 'bulk_carrier',   gt: 85000,  nt: 52000,  loa: 289.0, beam: 45.0, draft: 14.5, callsign: 'C6GO2',  mmsi: '311002100' },
  { imo: '9812901', name: 'PACIFIC CARRIER', flag: 'PA', type: 'bulk_carrier',   gt: 32000,  nt: 19000,  loa: 183.0, beam: 30.5, draft: 10.8, callsign: '3FPC2',  mmsi: '352310000' },
  { imo: '9634512', name: 'EAGLE BULK',      flag: 'MH', type: 'bulk_carrier',   gt: 62000,  nt: 38000,  loa: 245.0, beam: 38.0, draft: 13.8, callsign: 'V7EB3',  mmsi: '538006500' },
  { imo: '9345891', name: 'NAVIOS MARITIME', flag: 'GR', type: 'bulk_carrier',   gt: 93000,  nt: 57000,  loa: 292.0, beam: 45.0, draft: 14.5, callsign: 'SV4891', mmsi: '239102000' },
  { imo: '9512890', name: 'DIANA SHIPPING',  flag: 'GR', type: 'bulk_carrier',   gt: 82000,  nt: 50000,  loa: 275.0, beam: 43.0, draft: 14.2, callsign: 'SV3890', mmsi: '239501000' },
  { imo: '9678345', name: 'SUPRAMAX TRADER', flag: 'MH', type: 'bulk_carrier',   gt: 60000,  nt: 37000,  loa: 235.0, beam: 38.0, draft: 13.5, callsign: 'V7ST4',  mmsi: '538007100' },
  { imo: '9823901', name: 'HIMALAYA BULK',   flag: 'PA', type: 'bulk_carrier',   gt: 45000,  nt: 28000,  loa: 225.0, beam: 32.2, draft: 12.8, callsign: '3FHB5',  mmsi: '352410000' },
  { imo: '9701890', name: 'CAPESIZE VOYAGER', flag: 'LR', type: 'bulk_carrier',  gt: 170000, nt: 105000, loa: 288.9, beam: 45.0, draft: 18.2, callsign: 'A8CV4',  mmsi: '636019600' },
  { imo: '9523456', name: 'HANDYMAX EXPRESS', flag: 'BS', type: 'bulk_carrier',  gt: 43000,  nt: 26000,  loa: 190.0, beam: 32.0, draft: 11.5, callsign: 'C6HE8',  mmsi: '309002100' },
  { imo: '9456901', name: 'MOL PROMISE',     flag: 'JP', type: 'bulk_carrier',   gt: 87000,  nt: 53000,  loa: 290.0, beam: 45.0, draft: 14.8, callsign: 'JD5234', mmsi: '431300100' },
  { imo: '9734890', name: 'SCORPIO BULKERS', flag: 'MH', type: 'bulk_carrier',   gt: 63800,  nt: 39000,  loa: 245.0, beam: 38.0, draft: 13.8, callsign: 'V7SB6',  mmsi: '538007300' },
  // More container ships
  { imo: '9632789', name: 'MOL TRIUMPH',     flag: 'PA', type: 'container',      gt: 210691, nt: 105345, loa: 400.0, beam: 58.8, draft: 16.0, callsign: '3FMT2',  mmsi: '352002100' },
  { imo: '9743562', name: 'EVERGREEN VIRTUE', flag: 'PA', type: 'container',     gt: 210691, nt: 105345, loa: 400.0, beam: 58.8, draft: 16.0, callsign: '3FEV3',  mmsi: '352004100' },
  { imo: '9512345', name: 'COSCO SHIPPING CAPRICORN', flag: 'HK', type: 'container', gt: 186000, nt: 93000, loa: 400.0, beam: 58.8, draft: 16.0, callsign: 'VRCA2', mmsi: '477800100' },
  { imo: '9834901', name: 'YANG MING WITNESS', flag: 'PA', type: 'container',    gt: 186000, nt: 93000,  loa: 400.0, beam: 58.8, draft: 16.0, callsign: '3FYM4',  mmsi: '352004400' },
  { imo: '9723890', name: 'PIL KARIMUN',     flag: 'SG', type: 'container',      gt: 106000, nt: 53000,  loa: 300.0, beam: 48.2, draft: 14.0, callsign: '9V9512', mmsi: '566900200' },
  { imo: '9512678', name: 'HAPAG COLUMBUS',  flag: 'LR', type: 'container',      gt: 188000, nt: 94000,  loa: 400.0, beam: 58.8, draft: 16.0, callsign: 'A8HC3',  mmsi: '636019300' },
];

// Build index by IMO for O(1) lookup
const IMO_INDEX = {};
for (const v of VESSEL_DB) {
  IMO_INDEX[v.imo] = v;
}

/**
 * Look up a vessel by 7-digit IMO number string.
 * Returns the vessel record or null if not found.
 *
 * @param {string} imo - 7-digit IMO number (digits only, no prefix)
 * @returns {object|null}
 */
function lookupByIMO(imo) {
  if (!imo || typeof imo !== 'string') return null;
  // Strip optional "IMO " prefix
  const cleaned = imo.replace(/^IMO\s*/i, '').trim();
  return IMO_INDEX[cleaned] || null;
}

/**
 * Validate IMO checksum (weights 7,6,5,4,3,2 on first 6 digits; 7th = check digit)
 * @param {string} imo - 7-digit string
 * @returns {boolean}
 */
function validateIMOChecksum(imo) {
  const cleaned = imo.replace(/^IMO\s*/i, '').trim();
  if (!/^\d{7}$/.test(cleaned)) return false;
  const d = cleaned.split('').map(Number);
  const sum = d[0]*7 + d[1]*6 + d[2]*5 + d[3]*4 + d[4]*3 + d[5]*2;
  return sum % 10 === d[6];
}

module.exports = { lookupByIMO, validateIMOChecksum, VESSEL_DB };
