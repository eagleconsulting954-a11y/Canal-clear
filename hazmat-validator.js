/**
 * Hazmat AI Validator
 *
 * Validates hazardous cargo classifications against IMO IMDG Code
 * and Panama Canal Authority (ACP) restrictions.
 *
 * V2 scope: Full IMDG engine + Lithium Battery Specialist +
 *           Flash Point / SDS validation + DG Manifest generator.
 */

// ─────────────────────────────────────────────────────────────────────────────
// IMDG DATABASE — Selected UN numbers (most common maritime hazmat)
// ─────────────────────────────────────────────────────────────────────────────

const IMDG_DATABASE = {
  // CLASS 1 — EXPLOSIVES
  'UN0004': { proper_shipping_name: 'AMMONIUM PICRATE, dry or wetted with less than 10% water', class: '1.1D', pg: 'I', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN', 'MSC_CIRCULAR'], panama_restricted: true, panama_notes: 'Requires ACP advance notification 72h prior. Class 1.1/1.2 vessels must transit by day only.' },
  'UN0027': { proper_shipping_name: 'BLACK POWDER, compressed or BLACK POWDER, granular', class: '1.1D', pg: 'I', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN', 'MSC_CIRCULAR'], panama_restricted: true, panama_notes: 'Class 1 explosives: daytime transit only, ACP escort required.' },
  'UN0028': { proper_shipping_name: 'BLACK POWDER, compressed or BLACK POWDER, granular', class: '1.1D', pg: 'II', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN', 'MSC_CIRCULAR'], panama_restricted: true, panama_notes: 'Class 1 explosives: daytime transit only, ACP escort required.' },
  'UN0048': { proper_shipping_name: 'CHARGES, DEMOLITION', class: '1.1D', pg: 'I', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN'], panama_restricted: true, panama_notes: 'Class 1 explosives: daytime transit only.' },
  'UN0065': { proper_shipping_name: 'CORD, DETONATING, flexible', class: '1.1D', pg: 'II', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN'], panama_restricted: false },
  'UN0070': { proper_shipping_name: 'CORD, DETONATING, flexible', class: '1.4S', pg: 'II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN0164': { proper_shipping_name: 'DETONATORS FOR AMMUNITION', class: '1.1B', pg: 'I', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN', 'MSC_CIRCULAR'], panama_restricted: true, panama_notes: 'Class 1 explosives.' },
  'UN0212': { proper_shipping_name: 'CARTRIDGES FOR WEAPONS', class: '1.2C', pg: 'II', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN'], panama_restricted: true, panama_notes: 'Weapons-related Class 1.' },
  'UN0336': { proper_shipping_name: 'FIREWORKS', class: '1.3G', pg: 'II', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN'], panama_restricted: false },
  'UN0337': { proper_shipping_name: 'FIREWORKS', class: '1.4G', pg: 'II', doc_required: ['DG_MANIFEST'], panama_restricted: false },

  // CLASS 2 — GASES
  'UN1005': { proper_shipping_name: 'AMMONIA, ANHYDROUS', class: '2.3', subsidiary: '8', pg: null, doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE', 'CERTIFICATE_OF_FITNESS'], panama_restricted: true, panama_notes: 'Toxic gas. Must declare emergency contact and carry MFAGs (Medical First Aid Guide). Single-trip tanker only.' },
  'UN1010': { proper_shipping_name: 'BUTADIENES, STABILIZED', class: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },
  'UN1011': { proper_shipping_name: 'BUTANE', class: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },
  'UN1012': { proper_shipping_name: 'BUTYLENE', class: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },
  'UN1013': { proper_shipping_name: 'CARBON DIOXIDE', class: '2.2', pg: null, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1017': { proper_shipping_name: 'CHLORINE', class: '2.3', subsidiary: '5.1,8', pg: null, doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE', 'CERTIFICATE_OF_FITNESS'], panama_restricted: true, panama_notes: 'Highly toxic gas. Restricted quantities apply. Notify ACP 48h prior.' },
  'UN1023': { proper_shipping_name: 'COAL GAS, COMPRESSED', class: '2.3', subsidiary: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: true, panama_notes: 'Toxic and flammable.' },
  'UN1040': { proper_shipping_name: 'ETHYLENE OXIDE', class: '2.3', subsidiary: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Toxic + flammable gas. Restricted. Single-trip tanker requirement.' },
  'UN1045': { proper_shipping_name: 'FLUORINE, COMPRESSED', class: '2.3', subsidiary: '5.1,8', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Extremely toxic oxidizing gas. Prohibited for most vessels through the Canal.' },
  'UN1050': { proper_shipping_name: 'HYDROGEN CHLORIDE, ANHYDROUS', class: '2.3', subsidiary: '8', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Toxic corrosive gas.' },
  'UN1053': { proper_shipping_name: 'HYDROGEN SULPHIDE', class: '2.3', subsidiary: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Extremely toxic flammable gas.' },
  'UN1055': { proper_shipping_name: 'ISOBUTYLENE', class: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },
  'UN1060': { proper_shipping_name: 'METHYLACETYLENE AND PROPADIENE MIXTURE, STABILIZED', class: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },
  'UN1062': { proper_shipping_name: 'METHYL BROMIDE', class: '2.3', subsidiary: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Toxic gas.' },
  'UN1063': { proper_shipping_name: 'METHYL CHLORIDE', class: '2.1', subsidiary: '2.3', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },
  'UN1072': { proper_shipping_name: 'OXYGEN, COMPRESSED', class: '2.2', subsidiary: '5.1', pg: null, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1075': { proper_shipping_name: 'PETROLEUM GASES, LIQUEFIED', class: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },
  'UN1076': { proper_shipping_name: 'PHOSGENE', class: '2.3', subsidiary: '8', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'PROHIBITED through Panama Canal. Contact ACP before any transit with this cargo.' },
  'UN1079': { proper_shipping_name: 'SULPHUR DIOXIDE', class: '2.3', subsidiary: '8', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Toxic corrosive gas. Restricted quantities.' },
  'UN1086': { proper_shipping_name: 'VINYL CHLORIDE, STABILIZED', class: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },
  'UN1089': { proper_shipping_name: 'ACETALDEHYDE', class: '3', pg: 'I', flash_point: -38, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1978': { proper_shipping_name: 'PROPANE', class: '2.1', pg: null, doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },

  // CLASS 3 — FLAMMABLE LIQUIDS
  'UN1090': { proper_shipping_name: 'ACETONE', class: '3', pg: 'II', flash_point: -18, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1091': { proper_shipping_name: 'ACETONE OILS', class: '3', pg: 'I', flash_point: -17, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1114': { proper_shipping_name: 'BENZENE', class: '3', pg: 'II', flash_point: -11, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1133': { proper_shipping_name: 'ADHESIVES', class: '3', pg: 'I/II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1139': { proper_shipping_name: 'COATING SOLUTION', class: '3', pg: 'I/II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1145': { proper_shipping_name: 'CYCLOHEXANE', class: '3', pg: 'II', flash_point: -18, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1155': { proper_shipping_name: 'DIETHYL ETHER', class: '3', pg: 'I', flash_point: -45, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1170': { proper_shipping_name: 'ETHANOL SOLUTION', class: '3', pg: 'II/III', flash_point: 13, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1173': { proper_shipping_name: 'ETHYL ACETATE', class: '3', pg: 'II', flash_point: -4, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1203': { proper_shipping_name: 'GASOLINE', class: '3', pg: 'II', flash_point: -43, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1220': { proper_shipping_name: 'ISOPROPANOL', class: '3', pg: 'II', flash_point: 12, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1230': { proper_shipping_name: 'METHANOL', class: '3', subsidiary: '6.1', pg: 'II', flash_point: 11, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1263': { proper_shipping_name: 'PAINT', class: '3', pg: 'I/II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1267': { proper_shipping_name: 'PETROLEUM CRUDE OIL', class: '3', pg: 'I/II/III', doc_required: ['DG_MANIFEST', 'CERTIFICATE_OF_FITNESS'], panama_restricted: false },
  'UN1268': { proper_shipping_name: 'PETROLEUM DISTILLATES, N.O.S.', class: '3', pg: 'I/II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1294': { proper_shipping_name: 'TOLUENE', class: '3', pg: 'II', flash_point: 4, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1307': { proper_shipping_name: 'XYLENES', class: '3', pg: 'II/III', flash_point: 27, doc_required: ['DG_MANIFEST'], panama_restricted: false },

  // CLASS 4 — FLAMMABLE SOLIDS
  'UN1327': { proper_shipping_name: 'BHUSA OR HAY OR STRAW', class: '4.1', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1333': { proper_shipping_name: 'CERIUM, slabs, ingots or rods', class: '4.1', pg: 'II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1345': { proper_shipping_name: 'RUBBER SCRAP OR RUBBER SHODDY', class: '4.1', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1350': { proper_shipping_name: 'SULPHUR', class: '4.1', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1361': { proper_shipping_name: 'CHARCOAL', class: '4.2', pg: 'II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1362': { proper_shipping_name: 'ACTIVATED CARBON', class: '4.2', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1381': { proper_shipping_name: 'PHOSPHORUS, WHITE, DRY or under water or in solution', class: '4.2', subsidiary: '6.1', pg: 'I', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN'], panama_restricted: true, panama_notes: 'Highly toxic substance. ACP prior approval required.' },
  'UN1383': { proper_shipping_name: 'PYROPHORIC METAL, N.O.S.', class: '4.2', pg: 'I', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN'], panama_restricted: false },
  'UN1402': { proper_shipping_name: 'CALCIUM CARBIDE', class: '4.3', pg: 'I/II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1428': { proper_shipping_name: 'SODIUM', class: '4.3', pg: 'I', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN'], panama_restricted: false },
  'UN1436': { proper_shipping_name: 'ZINC POWDER OR ZINC DUST', class: '4.3', subsidiary: '4.2', pg: 'I/II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1442': { proper_shipping_name: 'AMMONIUM PERCHLORATE', class: '5.1', subsidiary: '1', pg: 'I', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN'], panama_restricted: true, panama_notes: 'Oxidizer with explosive subsidiary risk. Advance notification required.' },

  // CLASS 5 — OXIDIZERS & ORGANIC PEROXIDES
  'UN1449': { proper_shipping_name: 'BARIUM PEROXIDE', class: '5.1', subsidiary: '6.1', pg: 'II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1479': { proper_shipping_name: 'OXIDIZING SOLID, N.O.S.', class: '5.1', pg: 'I/II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1483': { proper_shipping_name: 'PEROXIDES, INORGANIC, N.O.S.', class: '5.1', pg: 'I/II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1498': { proper_shipping_name: 'SODIUM NITRATE', class: '5.1', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1499': { proper_shipping_name: 'SODIUM NITRATE AND POTASSIUM NITRATE MIXTURE', class: '5.1', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN2014': { proper_shipping_name: 'HYDROGEN PEROXIDE, AQUEOUS SOLUTION', class: '5.1', subsidiary: '8', pg: 'II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN2015': { proper_shipping_name: 'HYDROGEN PEROXIDE, STABILIZED', class: '5.1', subsidiary: '8', pg: 'I', doc_required: ['DG_MANIFEST', 'STOWAGE_PLAN'], panama_restricted: true, panama_notes: 'Concentrated peroxide. Stowage requirements apply.' },
  'UN2067': { proper_shipping_name: 'AMMONIUM NITRATE FERTILIZERS', class: '5.1', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },

  // CLASS 6 — TOXIC & INFECTIOUS SUBSTANCES
  'UN1583': { proper_shipping_name: 'CHLOROPICRIN MIXTURE, N.O.S.', class: '6.1', pg: 'I', doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Toxic material. Restricted transit.' },
  'UN1599': { proper_shipping_name: 'DINITROPHENOL SOLUTION', class: '6.1', pg: 'II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1603': { proper_shipping_name: 'ETHYL BROMOACETATE', class: '6.1', pg: 'I', doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE'], panama_restricted: false },
  'UN1647': { proper_shipping_name: 'METHYL BROMIDE AND ETHYLENE DIBROMIDE MIXTURE', class: '6.1', pg: 'I', doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Highly toxic.' },
  'UN1680': { proper_shipping_name: 'POTASSIUM CYANIDE', class: '6.1', pg: 'I', doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE', 'STOWAGE_PLAN'], panama_restricted: true, panama_notes: 'Cyanide: mandatory ACP prior notification and restricted stowage.' },
  'UN1689': { proper_shipping_name: 'SODIUM CYANIDE', class: '6.1', pg: 'I', doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE', 'STOWAGE_PLAN'], panama_restricted: true, panama_notes: 'Cyanide: mandatory ACP prior notification and restricted stowage.' },
  'UN1700': { proper_shipping_name: 'TEAR GAS CANDLES', class: '6.1', pg: 'II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1719': { proper_shipping_name: 'CAUSTIC ALKALI LIQUID, N.O.S.', class: '8', pg: 'II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN2315': { proper_shipping_name: 'POLYCHLORINATED BIPHENYLS', class: '9', pg: 'II', doc_required: ['DG_MANIFEST', 'SPECIAL_PERMIT'], panama_restricted: true, panama_notes: 'PCBs: environmental restriction. ACP advance permit required.' },
  'UN2814': { proper_shipping_name: 'INFECTIOUS SUBSTANCE, AFFECTING HUMANS', class: '6.2', pg: 'I', doc_required: ['DG_MANIFEST', 'INFECTIOUS_SUBSTANCE_CERT'], panama_restricted: true, panama_notes: 'Infectious substances require ACP prior approval and Panama health authority clearance.' },
  'UN2900': { proper_shipping_name: 'INFECTIOUS SUBSTANCE, AFFECTING ANIMALS', class: '6.2', pg: 'I', doc_required: ['DG_MANIFEST', 'INFECTIOUS_SUBSTANCE_CERT'], panama_restricted: true, panama_notes: 'Requires AUPSA (Panama agriculture authority) clearance.' },

  // CLASS 7 — RADIOACTIVE MATERIAL
  'UN2908': { proper_shipping_name: 'RADIOACTIVE MATERIAL, EXCEPTED PACKAGE', class: '7', pg: null, doc_required: ['DG_MANIFEST', 'RADIATION_CERT'], panama_restricted: true, panama_notes: 'All radioactive materials: ACP must be notified minimum 24h prior. NRC certificate required.' },
  'UN2910': { proper_shipping_name: 'RADIOACTIVE MATERIAL, EXCEPTED PACKAGE', class: '7', pg: null, doc_required: ['DG_MANIFEST', 'RADIATION_CERT'], panama_restricted: true, panama_notes: 'Radioactive: advance notification required.' },
  'UN2911': { proper_shipping_name: 'RADIOACTIVE MATERIAL, EXCEPTED PACKAGE', class: '7', pg: null, doc_required: ['DG_MANIFEST', 'RADIATION_CERT'], panama_restricted: true, panama_notes: 'Radioactive: advance notification required.' },
  'UN2912': { proper_shipping_name: 'RADIOACTIVE MATERIAL, LOW SPECIFIC ACTIVITY (LSA-I)', class: '7', pg: null, doc_required: ['DG_MANIFEST', 'RADIATION_CERT', 'COMPETENT_AUTHORITY_APPROVAL'], panama_restricted: true, panama_notes: 'Radioactive bulk: ACP Radiation Protection Program approval required.' },
  'UN3321': { proper_shipping_name: 'RADIOACTIVE MATERIAL, LOW SPECIFIC ACTIVITY (LSA-II)', class: '7', pg: null, doc_required: ['DG_MANIFEST', 'RADIATION_CERT', 'COMPETENT_AUTHORITY_APPROVAL'], panama_restricted: true, panama_notes: 'LSA-II: must comply with ACP Order MSD-8.' },
  'UN3322': { proper_shipping_name: 'RADIOACTIVE MATERIAL, LOW SPECIFIC ACTIVITY (LSA-III)', class: '7', pg: null, doc_required: ['DG_MANIFEST', 'RADIATION_CERT', 'COMPETENT_AUTHORITY_APPROVAL'], panama_restricted: true, panama_notes: 'Highest restriction for radioactive bulk cargo through Canal.' },

  // CLASS 8 — CORROSIVES
  'UN1755': { proper_shipping_name: 'CHROMIC ACID SOLUTION', class: '8', pg: 'II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1760': { proper_shipping_name: 'CORROSIVE LIQUID, N.O.S.', class: '8', pg: 'I/II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1779': { proper_shipping_name: 'FORMIC ACID', class: '8', pg: 'II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1789': { proper_shipping_name: 'HYDROCHLORIC ACID', class: '8', pg: 'II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1790': { proper_shipping_name: 'HYDROFLUORIC ACID', class: '8', subsidiary: '6.1', pg: 'I/II', doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'HF acid: highly toxic. Restricted quantities and prior ACP notice.' },
  'UN1791': { proper_shipping_name: 'HYPOCHLORITE SOLUTION', class: '8', pg: 'II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1830': { proper_shipping_name: 'SULPHURIC ACID', class: '8', pg: 'II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1831': { proper_shipping_name: 'SULPHURIC ACID, FUMING', class: '8', subsidiary: '6.1', pg: 'I', doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Oleum: restricted quantities, ACP prior notification.' },
  'UN1834': { proper_shipping_name: 'SULPHURYL CHLORIDE', class: '8', subsidiary: '6.1', pg: 'I', doc_required: ['DG_MANIFEST', 'EMERGENCY_SCHEDULE'], panama_restricted: true, panama_notes: 'Corrosive toxic. Restricted.' },
  'UN2031': { proper_shipping_name: 'NITRIC ACID, other than red fuming', class: '8', subsidiary: '5.1', pg: 'I/II', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN2672': { proper_shipping_name: 'AMMONIA SOLUTION', class: '8', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },

  // CLASS 9 — MISCELLANEOUS
  'UN1841': { proper_shipping_name: 'ACETALDEHYDE AMMONIA', class: '9', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1950': { proper_shipping_name: 'AEROSOLS', class: '2.1/2.2/2.3', pg: null, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN1999': { proper_shipping_name: 'TARS, LIQUID', class: '3', pg: 'II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN2212': { proper_shipping_name: 'ASBESTOS, AMPHIBOLE', class: '9', pg: 'II', doc_required: ['DG_MANIFEST', 'SPECIAL_PERMIT'], panama_restricted: true, panama_notes: 'Asbestos: Panama requires prior ACP authorization. Strict packaging requirements.' },
  'UN2590': { proper_shipping_name: 'ASBESTOS, CHRYSOTILE', class: '9', pg: 'III', doc_required: ['DG_MANIFEST', 'SPECIAL_PERMIT'], panama_restricted: true, panama_notes: 'Asbestos: Panama requires prior ACP authorization.' },
  'UN3077': { proper_shipping_name: 'ENVIRONMENTALLY HAZARDOUS SUBSTANCE, SOLID, N.O.S.', class: '9', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN3082': { proper_shipping_name: 'ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S.', class: '9', pg: 'III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN3166': { proper_shipping_name: 'VEHICLE, FLAMMABLE GAS POWERED', class: '9', pg: null, doc_required: ['DG_MANIFEST'], panama_restricted: false },
  'UN3171': { proper_shipping_name: 'BATTERY-POWERED VEHICLE', class: '9', pg: null, doc_required: ['DG_MANIFEST'], panama_restricted: false },

  // ── LITHIUM BATTERIES — high-detail entries ────────────────────────────────
  'UN3480': {
    proper_shipping_name: 'LITHIUM ION BATTERIES',
    class: '9',
    pg: 'II',
    doc_required: ['DG_MANIFEST', 'BATTERY_CERT'],
    panama_restricted: false,
    lithium: {
      type: 'ion',
      form: 'alone',
      section: 'IB',  // must use full Packing Instructions (P903/LP903) — Section IB
      packing_instruction: 'P903 / LP903',
      wh_limit_per_cell: null,  // no per-cell limit for IB
      wh_limit_per_battery: null,
      notes: 'UN3480 (Section IB): full IMDG packing requirements. Lithium Battery Test Summary (UN 38.3) mandatory. Must NOT be classified as Section II. If quantity is small (≤20 Wh/cell, ≤100 Wh/battery for Li-ion), reconsider if Section II (UN3481 packed-with or contained-in equipment) applies.',
      common_errors: [
        'Using UN3480 for batteries installed in or packed with equipment — should be UN3481',
        'Missing UN 38.3 Test Summary',
        'Declaring Section II limits for a Section IB shipment',
        'State of charge not limited to ≤30% for defective/damaged batteries',
      ],
    },
  },
  'UN3481': {
    proper_shipping_name: 'LITHIUM ION BATTERIES CONTAINED IN EQUIPMENT or PACKED WITH EQUIPMENT',
    class: '9',
    pg: 'II',
    doc_required: ['DG_MANIFEST'],
    panama_restricted: false,
    lithium: {
      type: 'ion',
      form: 'with_equipment',
      section: 'II',  // Section II (small quantities packed with or in equipment)
      packing_instruction: 'P903 / LP903 Section II or PI 967/970',
      wh_limit_per_cell: 20,     // Wh — Section II cell limit
      wh_limit_per_battery: 100, // Wh — Section II battery limit
      notes: 'UN3481 Section II: per cell ≤20 Wh, per battery ≤100 Wh. No quantity limit for passenger aircraft (IMDG only). Net weight limit 5 kg per package for Li-ion batteries packed with equipment. Overpack marking required. No UN 38.3 test summary required for Section II — but batteries must have passed testing.',
      common_errors: [
        'Applying UN3481 to standalone batteries not in/with equipment — should be UN3480',
        'Exceeding 20 Wh/cell or 100 Wh/battery without switching to Section IB (UN3480)',
        'Net weight >5 kg per package for batteries packed with equipment',
        'Missing overpack marking for multiple packages',
      ],
    },
  },
  'UN3090': {
    proper_shipping_name: 'LITHIUM METAL BATTERIES',
    class: '9',
    pg: 'II',
    doc_required: ['DG_MANIFEST', 'BATTERY_CERT'],
    panama_restricted: false,
    lithium: {
      type: 'metal',
      form: 'alone',
      section: 'IB',
      packing_instruction: 'P903 / LP903',
      li_content_per_cell: null,
      li_content_per_battery: null,
      notes: 'UN3090 (Section IB): lithium METAL batteries alone. Lithium Battery Test Summary (UN 38.3) mandatory. If batteries are installed in or packed with equipment, use UN3091 instead. Li content per cell ≤1 g (Section II) — larger: Section IB.',
      common_errors: [
        'Using UN3090 when batteries are in or packed with equipment — use UN3091',
        'Missing UN 38.3 Test Summary',
        'Confusing Li-metal (UN3090) with Li-ion (UN3480)',
        'Not restricting state of charge for defective/damaged batteries',
      ],
    },
  },
  'UN3091': {
    proper_shipping_name: 'LITHIUM METAL BATTERIES CONTAINED IN EQUIPMENT or PACKED WITH EQUIPMENT',
    class: '9',
    pg: 'II',
    doc_required: ['DG_MANIFEST'],
    panama_restricted: false,
    lithium: {
      type: 'metal',
      form: 'with_equipment',
      section: 'II',
      packing_instruction: 'P903 / LP903 Section II or PI 969/970',
      li_content_per_cell: 1,    // g — Section II cell limit
      li_content_per_battery: 2, // g — Section II battery limit
      notes: 'UN3091 Section II: per cell ≤1 g lithium content, per battery ≤2 g. Net weight limit 5 kg per package for Li-metal batteries packed with equipment. No UN 38.3 test summary required for Section II.',
      common_errors: [
        'Using UN3091 for standalone batteries — should be UN3090',
        'Exceeding 1 g Li/cell or 2 g Li/battery without switching to Section IB (UN3090)',
        'Confusing Li-metal (UN3091) with Li-ion (UN3481)',
      ],
    },
  },
  'UN3316': { proper_shipping_name: 'CHEMICAL KIT', class: '9', pg: 'II/III', doc_required: ['DG_MANIFEST'], panama_restricted: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// IMDG CLASS REFERENCE
// ─────────────────────────────────────────────────────────────────────────────

const IMDG_CLASS_DEFINITIONS = {
  '1':   { name: 'Explosives', subcategories: ['1.1','1.2','1.3','1.4','1.5','1.6'] },
  '1.1': { name: 'Explosives — Mass explosion hazard' },
  '1.2': { name: 'Explosives — Projection hazard but not mass explosion' },
  '1.3': { name: 'Explosives — Fire hazard and minor blast/projection hazard' },
  '1.4': { name: 'Explosives — No significant hazard' },
  '1.5': { name: 'Explosives — Very insensitive' },
  '1.6': { name: 'Explosives — Extremely insensitive' },
  '2':   { name: 'Gases', subcategories: ['2.1','2.2','2.3'] },
  '2.1': { name: 'Flammable gases' },
  '2.2': { name: 'Non-flammable, non-toxic gases' },
  '2.3': { name: 'Toxic gases' },
  '3':   { name: 'Flammable liquids' },
  '4':   { name: 'Flammable solids', subcategories: ['4.1','4.2','4.3'] },
  '4.1': { name: 'Flammable solids, self-reactive substances' },
  '4.2': { name: 'Substances liable to spontaneous combustion' },
  '4.3': { name: 'Substances which emit flammable gases on contact with water' },
  '5':   { name: 'Oxidizing substances and organic peroxides', subcategories: ['5.1','5.2'] },
  '5.1': { name: 'Oxidizing substances' },
  '5.2': { name: 'Organic peroxides' },
  '6':   { name: 'Toxic and infectious substances', subcategories: ['6.1','6.2'] },
  '6.1': { name: 'Toxic substances' },
  '6.2': { name: 'Infectious substances' },
  '7':   { name: 'Radioactive material' },
  '8':   { name: 'Corrosive substances' },
  '9':   { name: 'Miscellaneous dangerous substances and articles' },
};

// Flash point ranges for IMDG Class 3 Packaging Groups
// PG I:   flash point <23°C AND initial boiling point ≤35°C
// PG II:  flash point <23°C AND initial boiling point >35°C
// PG III: flash point ≥23°C but ≤60°C
const CLASS3_FLASHPOINT_RANGES = {
  I:   { min: null, max: 23, note: 'Class 3 PG I: flash point below 23°C with low initial boiling point (≤35°C).' },
  II:  { min: null, max: 23, note: 'Class 3 PG II: flash point below 23°C.' },
  III: { min: 23,   max: 60, note: 'Class 3 PG III: flash point between 23°C and 60°C.' },
};

// Class 3 flash point threshold: anything >60°C is NOT classified as Class 3
const CLASS3_MAX_FLASHPOINT = 60;

// ─────────────────────────────────────────────────────────────────────────────
// LITHIUM BATTERY UN NUMBERS SET
// ─────────────────────────────────────────────────────────────────────────────
const LITHIUM_UN_NUMBERS = new Set(['UN3480', 'UN3481', 'UN3090', 'UN3091']);

// ─────────────────────────────────────────────────────────────────────────────
// PACKAGING GROUPS
// ─────────────────────────────────────────────────────────────────────────────
const VALID_PACKAGING_GROUPS = ['I', 'II', 'III'];
const PACKAGING_GROUP_DESC = {
  'I':   'Great danger (high risk)',
  'II':  'Medium danger',
  'III': 'Minor danger',
};

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT LABELS
// ─────────────────────────────────────────────────────────────────────────────
const DOC_LABELS = {
  DG_MANIFEST:              'Dangerous Goods Manifest (DG Declaration)',
  STOWAGE_PLAN:             'Dangerous Goods Stowage Plan',
  CERTIFICATE_OF_FITNESS:   'Certificate of Fitness (for gas tankers)',
  EMERGENCY_SCHEDULE:       'Emergency Schedule (EmS) / MFAG reference',
  MSC_CIRCULAR:             'IMO MSC Circular acknowledgement',
  RADIATION_CERT:           'Radiation Transport Certificate',
  COMPETENT_AUTHORITY_APPROVAL: 'Competent Authority Approval (multilateral/unilateral)',
  INFECTIOUS_SUBSTANCE_CERT:'Infectious Substance Shipping Certificate',
  BATTERY_CERT:             'Lithium Battery Test Summary (UN 38.3)',
  SPECIAL_PERMIT:           'ACP Special Permit',
};

// ─────────────────────────────────────────────────────────────────────────────
// PANAMA CANAL RESTRICTED CLASSES
// ─────────────────────────────────────────────────────────────────────────────
const PANAMA_RESTRICTED_CLASSES = {
  '1.1': { level: 'HIGH', notes: 'Class 1.1 explosives: daytime transit only, ACP escort mandatory, 72h advance notice.' },
  '1.2': { level: 'HIGH', notes: 'Class 1.2 explosives: daytime transit only, ACP escort required.' },
  '1.3': { level: 'MEDIUM', notes: 'Class 1.3 explosives: advance ACP notification required.' },
  '2.3': { level: 'HIGH', notes: 'Toxic gases: emergency procedures documentation and ACP prior notification.' },
  '6.2': { level: 'HIGH', notes: 'Infectious substances: Panama health authority (MINSA) clearance required.' },
  '7':   { level: 'HIGH', notes: 'Radioactive material: ACP advance notification minimum 24h, NRC or equivalent certificate.' },
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function normalizeUN(raw) {
  if (!raw) return null;
  const cleaned = raw.toString().trim().toUpperCase().replace(/\s/g, '');
  if (cleaned.startsWith('UN')) return cleaned;
  if (/^\d{4}$/.test(cleaned)) return `UN${cleaned}`;
  return cleaned;
}

function normalizeIMDGClass(raw) {
  if (!raw) return null;
  let s = raw.toString().trim()
    .replace(/^class\s*/i, '')
    .replace(/^imdg\s*/i, '')
    .replace(/\.0$/, '');
  return s;
}

function classesMatch(input, dbClass) {
  if (!input || !dbClass) return false;
  const dbBase = dbClass.replace(/[A-Z]$/, '');
  if (input === dbBase) return true;
  if (input === dbBase.split('.')[0]) return true;
  if (dbBase.startsWith(input)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// LITHIUM BATTERY SPECIALIST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run lithium battery-specific validation checks.
 * Returns an array of check objects.
 */
function validateLithiumBattery(params, normalizedUN, dbEntry) {
  const checks = [];
  const info = dbEntry.lithium;

  if (!info) return checks;

  const {
    lithium_section,      // 'II' or 'IB' declared by user
    lithium_wh_cell,      // Wh per cell (ion)
    lithium_wh_battery,   // Wh per battery (ion)
    lithium_li_cell,      // g Li per cell (metal)
    lithium_li_battery,   // g Li per battery (metal)
    lithium_test_summary, // boolean: test summary available?
    lithium_cargo_type,   // 'alone' | 'with_equipment' | 'in_equipment'
  } = params;

  // ── 1. Battery type match ─────────────────────────────────────────────────
  const isIon   = ['UN3480','UN3481'].includes(normalizedUN);
  const isMetal = ['UN3090','UN3091'].includes(normalizedUN);
  const typeLabel = isIon ? 'Lithium-ION' : 'Lithium-METAL';

  checks.push({
    id: 'lb_type',
    name: `Battery Chemistry (${typeLabel})`,
    status: 'pass',
    message: `${normalizedUN} is correctly identified as ${typeLabel} battery.`,
    requirement: 'IMDG Code Special Provision 188 — Li-ion vs Li-metal differentiation.',
  });

  // ── 2. Section classification check ──────────────────────────────────────
  if (lithium_section) {
    const declaredSection = lithium_section.toUpperCase().replace(/SECTION\s*/i, '');
    const correctSection  = info.section;

    if (declaredSection === correctSection) {
      checks.push({
        id: 'lb_section',
        name: 'IMDG Section Classification',
        status: 'pass',
        message: `Correct: ${normalizedUN} (${info.proper_shipping_name || dbEntry.proper_shipping_name}) uses Section ${correctSection}.`,
        requirement: 'IMDG Code — Dangerous Goods List, Section II / IB classification.',
      });
    } else {
      checks.push({
        id: 'lb_section',
        name: 'IMDG Section Classification',
        status: 'fail',
        message: `SECTION MISMATCH: You declared Section ${declaredSection}, but ${normalizedUN} requires Section ${correctSection}.`,
        requirement: 'IMDG Code — Dangerous Goods List, Section II / IB classification.',
        suggestion: `Change to Section ${correctSection} for ${normalizedUN}. ${info.notes}`,
      });
    }
  } else {
    // Inform about section requirements
    checks.push({
      id: 'lb_section',
      name: 'IMDG Section Classification',
      status: 'warning',
      message: `${normalizedUN} uses Section ${info.section}. ${info.notes}`,
      requirement: 'IMDG Code — Dangerous Goods List, Section II / IB classification.',
      suggestion: `Confirm this is a Section ${info.section} shipment. Small-quantity batteries in/with equipment use Section II (UN3481/UN3091). Larger or standalone batteries use Section IB (UN3480/UN3090).`,
    });
  }

  // ── 3. UN number vs cargo form (alone vs with equipment) ─────────────────
  if (lithium_cargo_type) {
    const isAlone = lithium_cargo_type === 'alone';
    const withEq  = ['with_equipment','in_equipment'].includes(lithium_cargo_type);

    // UN3480/3090 = alone; UN3481/3091 = with/in equipment
    const expectedAlone = ['UN3480','UN3090'].includes(normalizedUN);
    const expectedWithEq = ['UN3481','UN3091'].includes(normalizedUN);

    if (expectedAlone && withEq) {
      checks.push({
        id: 'lb_cargo_form',
        name: 'Battery Form vs UN Number',
        status: 'fail',
        message: `MISMATCH: ${normalizedUN} is for standalone batteries, but you indicated batteries are ${lithium_cargo_type === 'with_equipment' ? 'packed with' : 'installed in'} equipment.`,
        requirement: 'IMDG Code — UN3480/3090 (alone) vs UN3481/3091 (with/in equipment).',
        suggestion: isIon
          ? 'Use UN3481 for lithium ion batteries in/with equipment.'
          : 'Use UN3091 for lithium metal batteries in/with equipment.',
      });
    } else if (expectedWithEq && isAlone) {
      checks.push({
        id: 'lb_cargo_form',
        name: 'Battery Form vs UN Number',
        status: 'fail',
        message: `MISMATCH: ${normalizedUN} is for batteries in/with equipment, but you indicated standalone batteries.`,
        requirement: 'IMDG Code — UN3480/3090 (alone) vs UN3481/3091 (with/in equipment).',
        suggestion: isIon
          ? 'Use UN3480 for standalone lithium ion batteries.'
          : 'Use UN3090 for standalone lithium metal batteries.',
      });
    } else {
      checks.push({
        id: 'lb_cargo_form',
        name: 'Battery Form vs UN Number',
        status: 'pass',
        message: `${normalizedUN} matches the declared cargo form (${lithium_cargo_type.replace(/_/g,' ')}).`,
        requirement: 'IMDG Code — UN3480/3090 (alone) vs UN3481/3091 (with/in equipment).',
      });
    }
  }

  // ── 4. Quantity limits (Section II only) ─────────────────────────────────
  if (info.section === 'II') {
    if (isIon) {
      // Check Wh limits
      const whCell     = parseFloat(lithium_wh_cell);
      const whBattery  = parseFloat(lithium_wh_battery);

      if (!isNaN(whCell)) {
        if (whCell > info.wh_limit_per_cell) {
          checks.push({
            id: 'lb_wh_cell',
            name: 'Energy per Cell (Wh) — Section II Limit',
            status: 'fail',
            message: `Cell energy ${whCell} Wh exceeds Section II limit of ${info.wh_limit_per_cell} Wh/cell for ${normalizedUN}.`,
            requirement: `IMDG SP 188 — Section II Li-ion: max ${info.wh_limit_per_cell} Wh per cell.`,
            suggestion: `With cells >20 Wh, this shipment must use Section IB (${isIon ? 'UN3480' : 'UN3090'}) with full packing requirements and UN 38.3 test summary.`,
          });
        } else {
          checks.push({
            id: 'lb_wh_cell',
            name: 'Energy per Cell (Wh) — Section II Limit',
            status: 'pass',
            message: `Cell energy ${whCell} Wh is within Section II limit (max ${info.wh_limit_per_cell} Wh/cell).`,
            requirement: `IMDG SP 188 — Section II Li-ion: max ${info.wh_limit_per_cell} Wh per cell.`,
          });
        }
      }

      if (!isNaN(whBattery)) {
        if (whBattery > info.wh_limit_per_battery) {
          checks.push({
            id: 'lb_wh_battery',
            name: 'Energy per Battery (Wh) — Section II Limit',
            status: 'fail',
            message: `Battery energy ${whBattery} Wh exceeds Section II limit of ${info.wh_limit_per_battery} Wh/battery for ${normalizedUN}.`,
            requirement: `IMDG SP 188 — Section II Li-ion: max ${info.wh_limit_per_battery} Wh per battery.`,
            suggestion: `Batteries >100 Wh must be shipped as Section IB (${isIon ? 'UN3480' : 'UN3090'}).`,
          });
        } else {
          checks.push({
            id: 'lb_wh_battery',
            name: 'Energy per Battery (Wh) — Section II Limit',
            status: 'pass',
            message: `Battery energy ${whBattery} Wh is within Section II limit (max ${info.wh_limit_per_battery} Wh/battery).`,
            requirement: `IMDG SP 188 — Section II Li-ion: max ${info.wh_limit_per_battery} Wh per battery.`,
          });
        }
      }
    }

    if (isMetal) {
      // Check Li content limits
      const liCell    = parseFloat(lithium_li_cell);
      const liBattery = parseFloat(lithium_li_battery);

      if (!isNaN(liCell)) {
        if (liCell > info.li_content_per_cell) {
          checks.push({
            id: 'lb_li_cell',
            name: 'Lithium Content per Cell (g) — Section II Limit',
            status: 'fail',
            message: `Li content ${liCell} g/cell exceeds Section II limit of ${info.li_content_per_cell} g/cell for ${normalizedUN}.`,
            requirement: `IMDG SP 188 — Section II Li-metal: max ${info.li_content_per_cell} g/cell.`,
            suggestion: 'Use Section IB (UN3090) for cells with >1 g Li content.',
          });
        } else {
          checks.push({
            id: 'lb_li_cell',
            name: 'Lithium Content per Cell (g) — Section II Limit',
            status: 'pass',
            message: `Li content ${liCell} g/cell is within Section II limit (max ${info.li_content_per_cell} g/cell).`,
            requirement: `IMDG SP 188 — Section II Li-metal: max ${info.li_content_per_cell} g/cell.`,
          });
        }
      }

      if (!isNaN(liBattery)) {
        if (liBattery > info.li_content_per_battery) {
          checks.push({
            id: 'lb_li_battery',
            name: 'Lithium Content per Battery (g) — Section II Limit',
            status: 'fail',
            message: `Li content ${liBattery} g/battery exceeds Section II limit of ${info.li_content_per_battery} g/battery for ${normalizedUN}.`,
            requirement: `IMDG SP 188 — Section II Li-metal: max ${info.li_content_per_battery} g/battery.`,
            suggestion: 'Use Section IB (UN3090) for batteries with >2 g total Li content.',
          });
        } else {
          checks.push({
            id: 'lb_li_battery',
            name: 'Lithium Content per Battery (g) — Section II Limit',
            status: 'pass',
            message: `Li content ${liBattery} g/battery is within Section II limit (max ${info.li_content_per_battery} g/battery).`,
            requirement: `IMDG SP 188 — Section II Li-metal: max ${info.li_content_per_battery} g/battery.`,
          });
        }
      }
    }
  }

  // ── 5. Test Summary (UN 38.3) requirement ────────────────────────────────
  const requiresTestSummary = info.section === 'IB'; // Section IB requires test summary
  if (requiresTestSummary) {
    if (lithium_test_summary === false || lithium_test_summary === 'false' || lithium_test_summary === 'no') {
      checks.push({
        id: 'lb_test_summary',
        name: 'UN 38.3 Lithium Battery Test Summary',
        status: 'fail',
        message: `Section IB (${normalizedUN}) requires a UN 38.3 Test Summary. You indicated it is NOT available.`,
        requirement: 'IMDG Code SP 188 / IMDG 2.9.4 — Battery Test Summary for Section IB.',
        suggestion: 'Obtain the UN 38.3 Test Summary from the battery manufacturer before shipment. This is mandatory for Section IB lithium batteries.',
      });
    } else if (lithium_test_summary === true || lithium_test_summary === 'true' || lithium_test_summary === 'yes') {
      checks.push({
        id: 'lb_test_summary',
        name: 'UN 38.3 Lithium Battery Test Summary',
        status: 'pass',
        message: 'UN 38.3 Test Summary confirmed available for this Section IB shipment.',
        requirement: 'IMDG Code SP 188 / IMDG 2.9.4 — Battery Test Summary for Section IB.',
      });
    } else {
      checks.push({
        id: 'lb_test_summary',
        name: 'UN 38.3 Lithium Battery Test Summary',
        status: 'warning',
        message: `UN 38.3 Test Summary is MANDATORY for Section IB (${normalizedUN}). Confirm it is available and will be provided on request.`,
        requirement: 'IMDG Code SP 188 / IMDG 2.9.4 — Battery Test Summary for Section IB.',
        suggestion: 'The Test Summary must be available for inspection by authorities. Include it with the DG documentation.',
      });
    }
  } else {
    // Section II — test summary not required but batteries must have passed
    checks.push({
      id: 'lb_test_summary',
      name: 'UN 38.3 Lithium Battery Test Summary',
      status: 'pass',
      message: `Section II (${normalizedUN}): UN 38.3 Test Summary not required to be provided, but batteries must have passed UN 38.3 testing.`,
      requirement: 'IMDG Code SP 188 — Section II batteries.',
    });
  }

  // ── 6. Common errors info ─────────────────────────────────────────────────
  if (info.common_errors && info.common_errors.length > 0) {
    checks.push({
      id: 'lb_common_errors',
      name: 'Common Lithium Battery Filing Errors',
      status: 'warning',
      message: `For ${normalizedUN}: watch for these common IMDG misclassification errors.`,
      requirement: 'IMDG Code — Lithium Battery Special Provisions.',
      suggestion: info.common_errors.map((e, i) => `${i+1}. ${e}`).join(' | '),
    });
  }

  return checks;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLASH POINT / SDS VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate flash point consistency with declared IMDG class and packaging group.
 * Only applicable for Class 3 substances.
 */
function validateFlashPoint(params, normalizedClass, normalizedPG, dbEntry, normalizedUN) {
  const checks = [];
  const { flash_point } = params;

  if (flash_point === undefined || flash_point === null || flash_point === '') {
    return checks; // No flash point provided — skip
  }

  const fp = parseFloat(flash_point);
  if (isNaN(fp)) {
    checks.push({
      id: 'flash_point_valid',
      name: 'Flash Point Value',
      status: 'fail',
      message: `Flash point "${flash_point}" is not a valid number. Enter the flash point in °C from the Safety Data Sheet.`,
      requirement: 'IMDG Code Chapter 2.3 — Flash point for Class 3 classification.',
    });
    return checks;
  }

  // Check against IMDG database entry
  if (dbEntry && dbEntry.flash_point !== undefined) {
    const dbFP = dbEntry.flash_point;
    const diff = Math.abs(fp - dbFP);
    if (diff > 5) {
      checks.push({
        id: 'flash_point_sds_match',
        name: 'Flash Point vs IMDG Reference',
        status: 'warning',
        message: `Your declared flash point (${fp}°C) differs significantly from the IMDG reference for ${normalizedUN || dbEntry.proper_shipping_name} (${dbFP}°C). Difference: ${diff.toFixed(1)}°C.`,
        requirement: 'IMDG Code — Safety Data Sheet (Section 9: Physical properties) must match transport classification.',
        suggestion: `Verify the flash point from the current SDS. If the substance is a mixture, the flash point may vary. IMDG reference: ${dbFP}°C.`,
      });
    } else {
      checks.push({
        id: 'flash_point_sds_match',
        name: 'Flash Point vs IMDG Reference',
        status: 'pass',
        message: `Flash point ${fp}°C is consistent with IMDG reference (${dbFP}°C) for this substance.`,
        requirement: 'IMDG Code — Safety Data Sheet (Section 9: Physical properties).',
      });
    }
  }

  // Class 3 validation
  if (normalizedClass === '3' || (dbEntry && dbEntry.class === '3')) {
    if (fp > CLASS3_MAX_FLASHPOINT) {
      checks.push({
        id: 'flash_point_class3',
        name: 'Flash Point vs Class 3 Threshold',
        status: 'fail',
        message: `Flash point ${fp}°C exceeds the Class 3 maximum threshold of ${CLASS3_MAX_FLASHPOINT}°C. Substances with flash points above 60°C are NOT classified as IMDG Class 3 flammable liquids.`,
        requirement: 'IMDG Code 2.3.1 — Class 3 definition: flash point ≤60°C.',
        suggestion: 'Review the IMDG classification. Substances with flash points >60°C may be Class 9 or not classified as DG at all. Check if heating cargo: special provisions apply.',
      });
    } else {
      // Check PG consistency
      if (normalizedPG && CLASS3_FLASHPOINT_RANGES[normalizedPG]) {
        const range = CLASS3_FLASHPOINT_RANGES[normalizedPG];
        let pgOk = true;
        let pgMsg = '';

        if (normalizedPG === 'III' && fp < 23) {
          pgOk = false;
          pgMsg = `Flash point ${fp}°C is too low for PG III (requires ≥23°C). This substance may be PG I or II.`;
        } else if ((normalizedPG === 'I' || normalizedPG === 'II') && fp >= 23) {
          pgOk = false;
          pgMsg = `Flash point ${fp}°C is ≥23°C, which is inconsistent with PG ${normalizedPG}. PG I and II require flash points below 23°C. Consider PG III.`;
        }

        if (!pgOk) {
          checks.push({
            id: 'flash_point_pg',
            name: 'Flash Point vs Packaging Group',
            status: 'fail',
            message: `Packaging Group mismatch: ${pgMsg}`,
            requirement: 'IMDG Code 2.3.2 — Assignment of packaging groups for Class 3.',
            suggestion: 'Review packaging group assignment: PG I (<23°C, boiling pt ≤35°C), PG II (<23°C, boiling pt >35°C), PG III (≥23°C to ≤60°C).',
          });
        } else {
          checks.push({
            id: 'flash_point_pg',
            name: 'Flash Point vs Packaging Group',
            status: 'pass',
            message: `Flash point ${fp}°C is consistent with PG ${normalizedPG} for Class 3.`,
            requirement: 'IMDG Code 2.3.2 — Assignment of packaging groups for Class 3.',
          });
        }
      } else {
        checks.push({
          id: 'flash_point_class3',
          name: 'Flash Point (Class 3)',
          status: 'pass',
          message: `Flash point ${fp}°C is within Class 3 range (≤60°C). Class 3 flammable liquid classification is consistent.`,
          requirement: 'IMDG Code 2.3.1 — Class 3 definition.',
        });
      }
    }
  } else if (normalizedClass && normalizedClass !== '3') {
    // Non-Class-3 but flash point provided
    if (fp <= CLASS3_MAX_FLASHPOINT && fp > -100) {
      checks.push({
        id: 'flash_point_class_mismatch',
        name: 'Flash Point vs Declared Class',
        status: 'warning',
        message: `Flash point ${fp}°C is in the Class 3 range (≤60°C), but you declared Class ${normalizedClass}. Verify the classification is correct — substances with flash points ≤60°C may require Class 3 designation.`,
        requirement: 'IMDG Code 2.3.1 — Class 3 definition.',
        suggestion: 'Check Section 14 of the SDS for transport classification. If the substance has a flash point ≤60°C, Class 3 must be considered.',
      });
    }
  }

  return checks;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN VALIDATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run full hazmat validation
 * @param {Object} params
 */
function validateHazmat(params) {
  const checks = [];
  const {
    cargo_description = '',
    un_number,
    imdg_class,
    packaging_group,
    packaging_type,
    quantity,
    quantity_unit,
    flash_point,
    // Lithium battery fields
    lithium_section,
    lithium_wh_cell,
    lithium_wh_battery,
    lithium_li_cell,
    lithium_li_battery,
    lithium_test_summary,
    lithium_cargo_type,
  } = params;

  const normalizedUN    = normalizeUN(un_number);
  const normalizedClass = normalizeIMDGClass(imdg_class);
  const normalizedPG    = packaging_group ? packaging_group.toString().trim().toUpperCase() : null;

  const dbEntry  = normalizedUN ? IMDG_DATABASE[normalizedUN] : null;
  const classInfo = normalizedClass ? IMDG_CLASS_DEFINITIONS[normalizedClass] : null;
  const isLithium = normalizedUN ? LITHIUM_UN_NUMBERS.has(normalizedUN) : false;

  // ── 1. UN Number Format ──────────────────────────────────────────────────
  if (normalizedUN) {
    const validFormat = /^UN\d{4}$/.test(normalizedUN);
    checks.push({
      id: 'un_format',
      name: 'UN Number Format',
      status: validFormat ? 'pass' : 'fail',
      message: validFormat
        ? `UN number ${normalizedUN} has correct format.`
        : `UN number "${un_number}" is malformatted. Required format: UN followed by 4 digits (e.g. UN1203).`,
      requirement: 'IMDG Code Chapter 3.1 — proper shipping name and UN number format.',
      suggestion: validFormat ? null : 'Check the UN number on your Safety Data Sheet (SDS). Format: UN1234.',
    });
  } else {
    checks.push({
      id: 'un_format',
      name: 'UN Number Provided',
      status: 'warning',
      message: 'No UN number provided. UN numbers are mandatory for all IMDG regulated hazardous cargo.',
      requirement: 'IMDG Code 3.1.2 — UN number required on DG manifest.',
      suggestion: 'Obtain the UN number from the Safety Data Sheet (SDS) or IMDG Code Vol. II.',
    });
  }

  // ── 2. UN Number in IMDG Database ────────────────────────────────────────
  if (normalizedUN && /^UN\d{4}$/.test(normalizedUN)) {
    if (dbEntry) {
      checks.push({
        id: 'un_recognized',
        name: 'UN Number Recognized',
        status: 'pass',
        message: `${normalizedUN} is recognized: ${dbEntry.proper_shipping_name}`,
        requirement: 'IMDG Code Vol. II — Dangerous Goods List.',
      });
    } else {
      checks.push({
        id: 'un_recognized',
        name: 'UN Number in IMDG Database',
        status: 'warning',
        message: `${normalizedUN} is not in the common IMDG database. This may be a valid but uncommon substance. Verify against the official IMDG Code Volume II.`,
        requirement: 'IMDG Code Vol. II — Dangerous Goods List.',
        suggestion: 'Cross-check with the printed IMDG Code or consult your DG specialist.',
      });
    }
  }

  // ── 3. IMDG Class Validation ──────────────────────────────────────────────
  if (normalizedClass) {
    const classKnown = !!IMDG_CLASS_DEFINITIONS[normalizedClass];
    checks.push({
      id: 'imdg_class_valid',
      name: 'IMDG Class Valid',
      status: classKnown ? 'pass' : 'fail',
      message: classKnown
        ? `IMDG Class ${normalizedClass} (${IMDG_CLASS_DEFINITIONS[normalizedClass].name}) is valid.`
        : `IMDG Class "${imdg_class}" is not recognized. Valid classes: 1, 1.1–1.6, 2.1, 2.2, 2.3, 3, 4.1, 4.2, 4.3, 5.1, 5.2, 6.1, 6.2, 7, 8, 9.`,
      requirement: 'IMDG Code Chapter 2 — Classification.',
      suggestion: classKnown ? null : 'Use the exact IMDG class designation from the substance Safety Data Sheet.',
    });
  } else {
    checks.push({
      id: 'imdg_class_valid',
      name: 'IMDG Class Provided',
      status: 'warning',
      message: 'No IMDG class provided. Required for all DG shipments.',
      requirement: 'IMDG Code 5.4.1 — DG manifest must state hazard class.',
      suggestion: 'Find the IMDG class on the Safety Data Sheet (Section 14: Transport Information).',
    });
  }

  // ── 4. UN ↔ Class Cross-Check ─────────────────────────────────────────────
  if (dbEntry && normalizedClass) {
    const match = classesMatch(normalizedClass, dbEntry.class);
    checks.push({
      id: 'un_class_match',
      name: 'UN Number ↔ IMDG Class Match',
      status: match ? 'pass' : 'fail',
      message: match
        ? `UN number ${normalizedUN} correctly classified as Class ${normalizedClass}.`
        : `MISMATCH: ${normalizedUN} (${dbEntry.proper_shipping_name}) should be Class ${dbEntry.class}, but you declared Class ${normalizedClass}.`,
      requirement: 'IMDG Code 3.2 — Dangerous Goods List column (2) and (3a).',
      suggestion: match ? null : `Change IMDG class to ${dbEntry.class} for ${normalizedUN}.`,
      correct_class: match ? null : dbEntry.class,
    });
  }

  // ── 5. Cargo Description ↔ UN Proper Shipping Name ───────────────────────
  if (dbEntry && cargo_description) {
    const desc = cargo_description.toUpperCase();
    const psn  = dbEntry.proper_shipping_name.toUpperCase();
    const psnWords   = psn.split(/[\s,\/]+/).filter(w => w.length > 3);
    const overlap    = psnWords.filter(w => desc.includes(w));
    const matchRatio = psnWords.length > 0 ? overlap.length / psnWords.length : 0;

    if (matchRatio >= 0.4) {
      checks.push({
        id: 'desc_match',
        name: 'Cargo Description Alignment',
        status: 'pass',
        message: `Cargo description matches the proper shipping name for ${normalizedUN}.`,
        requirement: 'IMDG Code 5.4.1.4.1 — Proper Shipping Name on DG manifest.',
      });
    } else {
      checks.push({
        id: 'desc_match',
        name: 'Cargo Description Alignment',
        status: 'warning',
        message: `Cargo description "${cargo_description}" may not match the IMDG Proper Shipping Name: "${dbEntry.proper_shipping_name}". Review for accuracy.`,
        requirement: 'IMDG Code 5.4.1.4.1 — Proper Shipping Name on DG manifest.',
        suggestion: `Use the official Proper Shipping Name: "${dbEntry.proper_shipping_name}" on all shipping documents.`,
        proper_shipping_name: dbEntry.proper_shipping_name,
      });
    }
  }

  // ── 6. Packaging Group ────────────────────────────────────────────────────
  if (normalizedPG) {
    const pgValid = VALID_PACKAGING_GROUPS.includes(normalizedPG);
    let pgClassConflict = false;
    if (dbEntry && pgValid && normalizedPG === 'I' && dbEntry.pg && !dbEntry.pg.includes('I')) {
      pgClassConflict = true;
    }
    checks.push({
      id: 'packing_group',
      name: 'Packaging Group',
      status: pgValid ? (pgClassConflict ? 'warning' : 'pass') : 'fail',
      message: pgValid
        ? (pgClassConflict
          ? `Packaging Group ${normalizedPG} may not apply to ${normalizedUN}. Typical PG for this substance: ${dbEntry.pg}.`
          : `Packaging Group ${normalizedPG} (${PACKAGING_GROUP_DESC[normalizedPG]}) noted.`)
        : `Invalid Packaging Group "${packaging_group}". Must be I, II, or III.`,
      requirement: 'IMDG Code 2.0.1 — Packaging Groups.',
      suggestion: pgValid ? null : 'Use Roman numerals I, II, or III for packaging group.',
    });
  }

  // ── 7. Quantity Declared ──────────────────────────────────────────────────
  if (quantity !== undefined && quantity !== null && quantity !== '') {
    const qty = parseFloat(quantity);
    const validQty = !isNaN(qty) && qty > 0;
    checks.push({
      id: 'quantity',
      name: 'Quantity Declared',
      status: validQty ? 'pass' : 'fail',
      message: validQty
        ? `Declared quantity: ${qty} ${quantity_unit || 'units'}.`
        : `Invalid quantity "${quantity}". Must be a positive number.`,
      requirement: 'IMDG Code 5.4.1.4.2 — Quantity on DG manifest.',
      suggestion: validQty ? null : 'Enter the total gross mass or net quantity in kg or L.',
    });
  } else {
    checks.push({
      id: 'quantity',
      name: 'Quantity Declared',
      status: 'warning',
      message: 'No quantity declared. Quantity is required on the Dangerous Goods Manifest.',
      requirement: 'IMDG Code 5.4.1.4.2 — Quantity required on DG manifest.',
      suggestion: 'Declare total gross mass (kg) or net quantity per IMDG Code requirements.',
    });
  }

  // ── 8. Packaging Type ─────────────────────────────────────────────────────
  if (!packaging_type || packaging_type.trim() === '') {
    checks.push({
      id: 'packaging_type',
      name: 'Packaging Type Declared',
      status: 'warning',
      message: 'No packaging type specified. IMDG Code requires packaging type/specification on DG documentation.',
      requirement: 'IMDG Code 5.4.1.4.1(e) — Type of packaging.',
      suggestion: 'State packaging type: drums, IBCs, cylinders, tank containers, bulk, etc.',
    });
  } else {
    checks.push({
      id: 'packaging_type',
      name: 'Packaging Type Declared',
      status: 'pass',
      message: `Packaging type declared: ${packaging_type}.`,
      requirement: 'IMDG Code 5.4.1.4.1(e) — Type of packaging.',
    });
  }

  // ── 9. Required Documentation ─────────────────────────────────────────────
  if (dbEntry) {
    const docList = dbEntry.doc_required.map(d => DOC_LABELS[d] || d);
    checks.push({
      id: 'required_docs',
      name: 'Required Documents',
      status: 'pass',
      message: `For ${normalizedUN}, the following documents are required: ${docList.join('; ')}.`,
      requirement: 'IMDG Code 5.4 — Documentation.',
      required_documents: dbEntry.doc_required.map(d => ({ code: d, label: DOC_LABELS[d] || d })),
    });
  }

  // ── 10. Panama Canal Restrictions ────────────────────────────────────────
  const panRestByClass = normalizedClass ? PANAMA_RESTRICTED_CLASSES[normalizedClass] : null;
  const panRestByEntry = dbEntry ? dbEntry.panama_restricted : false;

  if (panRestByEntry || panRestByClass) {
    const level = panRestByClass ? panRestByClass.level : 'MEDIUM';
    const notes = [
      panRestByEntry && dbEntry.panama_notes ? dbEntry.panama_notes : null,
      panRestByClass ? panRestByClass.notes : null,
    ].filter(Boolean).join(' ');

    checks.push({
      id: 'panama_restriction',
      name: 'Panama Canal Restriction',
      status: level === 'HIGH' ? 'fail' : 'warning',
      message: `⚠️ PANAMA CANAL RESTRICTION: ${notes}`,
      requirement: 'ACP Notice to Shipping — Dangerous Goods and Hazardous Cargo Transit Regulations.',
      suggestion: 'Contact ACP Maritime Operations at +507 272-4202 or filing via VUMPA prior to transit booking.',
    });
  } else {
    checks.push({
      id: 'panama_restriction',
      name: 'Panama Canal Restriction',
      status: 'pass',
      message: dbEntry
        ? `${normalizedUN} has no known Panama Canal transit restrictions.`
        : 'No Panama Canal restrictions identified based on provided classification.',
      requirement: 'ACP Notice to Shipping — Hazardous Cargo Transit Regulations.',
    });
  }

  // ── 11. Subsidiary Hazard ─────────────────────────────────────────────────
  if (dbEntry && dbEntry.subsidiary) {
    checks.push({
      id: 'subsidiary_hazard',
      name: 'Subsidiary Hazard',
      status: 'warning',
      message: `${normalizedUN} has subsidiary hazard(s): Class ${dbEntry.subsidiary}. Labels and documentation must reflect ALL hazards.`,
      requirement: 'IMDG Code 5.2.2 — Multiple hazard labels required.',
      suggestion: `Ensure cargo labels display both primary class (${dbEntry.class}) and subsidiary hazard (Class ${dbEntry.subsidiary}) placards.`,
    });
  }

  // ── 12. Flash Point Validation ────────────────────────────────────────────
  if (flash_point !== undefined && flash_point !== null && flash_point !== '') {
    const fpChecks = validateFlashPoint(params, normalizedClass, normalizedPG, dbEntry, normalizedUN);
    checks.push(...fpChecks);
  }

  // ── 13. Lithium Battery Specialist ───────────────────────────────────────
  if (isLithium && dbEntry) {
    const lbChecks = validateLithiumBattery(params, normalizedUN, dbEntry);
    checks.push(...lbChecks);
  }

  // ── Build Result ──────────────────────────────────────────────────────────
  const passed   = checks.filter(c => c.status === 'pass').length;
  const failed   = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warning').length;

  const overallStatus = failed > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed';

  return {
    overall_status: overallStatus,
    total_checks: checks.length,
    passed_checks: passed,
    failed_checks: failed,
    warning_checks: warnings,
    is_lithium_battery: isLithium,
    checklist: checks,
    cargo_info: dbEntry ? {
      un_number: normalizedUN,
      proper_shipping_name: dbEntry.proper_shipping_name,
      imdg_class: dbEntry.class,
      subsidiary_hazard: dbEntry.subsidiary || null,
      packaging_group: dbEntry.pg,
      flash_point_ref: dbEntry.flash_point !== undefined ? dbEntry.flash_point : null,
      panama_restricted: dbEntry.panama_restricted,
      required_documents: dbEntry.doc_required.map(d => ({ code: d, label: DOC_LABELS[d] || d })),
      lithium_info: dbEntry.lithium || null,
    } : null,
    categories: {
      critical: checks.filter(c => c.status === 'fail'),
      warnings: checks.filter(c => c.status === 'warning'),
      passed:   checks.filter(c => c.status === 'pass'),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DG MANIFEST GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a pre-filled Dangerous Goods Manifest based on validated cargo data.
 * Returns a structured manifest object + formatted text for display/download.
 *
 * @param {Object} params — same fields as validateHazmat, plus vessel/shipper info
 * @returns {Object} { manifest, text, errors }
 */
function generateDGManifest(params) {
  const {
    cargo_description,
    un_number,
    imdg_class,
    packaging_group,
    packaging_type,
    quantity,
    quantity_unit,
    flash_point,
    // Vessel / shipper fields
    vessel_name,
    imo_number,
    voyage_number,
    port_of_loading,
    port_of_discharge,
    shipper_name,
    consignee_name,
    emergency_contact,
    // Date
    declaration_date,
  } = params;

  const normalizedUN    = normalizeUN(un_number);
  const normalizedClass = normalizeIMDGClass(imdg_class);
  const dbEntry = normalizedUN ? IMDG_DATABASE[normalizedUN] : null;

  const errors = [];

  if (!normalizedUN) errors.push('UN number is required for DG Manifest generation.');
  if (!normalizedClass) errors.push('IMDG Class is required for DG Manifest generation.');

  const today = declaration_date || new Date().toISOString().slice(0, 10);
  const properShippingName = dbEntry
    ? dbEntry.proper_shipping_name
    : (cargo_description || 'N/A — Verify with IMDG Code');

  const requiredDocs = dbEntry
    ? dbEntry.doc_required.map(d => DOC_LABELS[d] || d)
    : ['Dangerous Goods Manifest (DG Declaration)'];

  const manifest = {
    // Header
    document_type:         'IMDG Dangerous Goods Manifest',
    declaration_date:      today,
    // Vessel
    vessel_name:           vessel_name || '',
    imo_number:            imo_number || '',
    voyage_number:         voyage_number || '',
    port_of_loading:       port_of_loading || '',
    port_of_discharge:     port_of_discharge || '',
    // Cargo
    un_number:             normalizedUN || '',
    proper_shipping_name:  properShippingName,
    imdg_class:            normalizedClass || '',
    subsidiary_hazard:     dbEntry?.subsidiary || '',
    packaging_group:       packaging_group || dbEntry?.pg || '',
    packaging_type:        packaging_type || '',
    quantity:              quantity ? `${quantity} ${quantity_unit || 'kg'}` : '',
    flash_point:           flash_point ? `${flash_point}°C` : (dbEntry?.flash_point !== undefined ? `${dbEntry.flash_point}°C (ref)` : 'N/A'),
    // Parties
    shipper_name:          shipper_name || '',
    consignee_name:        consignee_name || '',
    emergency_contact:     emergency_contact || '',
    // Panama
    panama_restricted:     dbEntry?.panama_restricted || false,
    panama_notes:          dbEntry?.panama_notes || '',
    // Docs
    required_documents:    requiredDocs,
  };

  // Format as readable text
  const text = [
    '═══════════════════════════════════════════════════════════════',
    '          DANGEROUS GOODS MANIFEST / DECLARATION',
    '         Panama Canal Transit — IMDG Code Compliant',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Date:                    ${manifest.declaration_date}`,
    `Vessel Name:             ${manifest.vessel_name || '[REQUIRED]'}`,
    `IMO Number:              ${manifest.imo_number || '[REQUIRED]'}`,
    `Voyage Number:           ${manifest.voyage_number || '[REQUIRED]'}`,
    `Port of Loading:         ${manifest.port_of_loading || '[REQUIRED]'}`,
    `Port of Discharge:       ${manifest.port_of_discharge || '[REQUIRED]'}`,
    '',
    '─── DANGEROUS GOODS DETAILS ────────────────────────────────────',
    '',
    `UN Number:               ${manifest.un_number || '[REQUIRED]'}`,
    `Proper Shipping Name:    ${manifest.proper_shipping_name}`,
    `IMDG Class:              ${manifest.imdg_class || '[REQUIRED]'}`,
    `Subsidiary Hazard:       ${manifest.subsidiary_hazard || 'None'}`,
    `Packaging Group:         ${manifest.packaging_group || '[REQUIRED]'}`,
    `Packaging Type:          ${manifest.packaging_type || '[REQUIRED]'}`,
    `Total Quantity:          ${manifest.quantity || '[REQUIRED]'}`,
    `Flash Point:             ${manifest.flash_point}`,
    '',
    '─── PARTIES ─────────────────────────────────────────────────────',
    '',
    `Shipper/Consignor:       ${manifest.shipper_name || '[REQUIRED]'}`,
    `Consignee:               ${manifest.consignee_name || '[REQUIRED]'}`,
    `Emergency Contact (24h): ${manifest.emergency_contact || '[REQUIRED — CHEMTREC: +1-703-527-3887]'}`,
    '',
    '─── PANAMA CANAL NOTIFICATION ───────────────────────────────────',
    '',
    manifest.panama_restricted
      ? `⚠️  RESTRICTED CARGO: ${manifest.panama_notes}`
      : '✓  No ACP-specific restrictions identified for this cargo.',
    '',
    '─── REQUIRED DOCUMENTS ──────────────────────────────────────────',
    '',
    ...manifest.required_documents.map((d, i) => `  ${i+1}. ${d}`),
    '',
    '─── DECLARATION ─────────────────────────────────────────────────',
    '',
    'I hereby declare that the contents of this consignment are fully',
    'and accurately described above by the proper shipping name, and',
    'are classified, packaged, marked and labelled, and are in all',
    'respects in proper condition for transport according to applicable',
    'international and national governmental regulations.',
    '',
    `Shipper Signature: _______________________  Date: ${manifest.declaration_date}`,
    '',
    '═══════════════════════════════════════════════════════════════',
    '  Generated by CanalClear — Panama Canal Compliance Platform',
    '  Verify against official IMDG Code and ACP requirements.',
    '═══════════════════════════════════════════════════════════════',
  ].join('\n');

  return { manifest, text, errors };
}

module.exports = {
  validateHazmat,
  generateDGManifest,
  IMDG_DATABASE,
  IMDG_CLASS_DEFINITIONS,
  LITHIUM_UN_NUMBERS,
  normalizeUN,
  normalizeIMDGClass,
  DOC_LABELS,
};
