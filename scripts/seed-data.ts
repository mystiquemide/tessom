export type SeedOwner = {
  id: string
  name: string
  email: string
  kind: 'client' | 'designer' | 'workshop'
  shareBps: number
}

export type SeedTemplatePiece = {
  key: string
  label: string
  wCm: number
  hCm: number
  qty: number
  centerPattern: boolean
}

export type SeedTemplate = {
  id: string
  name: string
  kind: 'cushion' | 'bench-pad' | 'lumbar' | 'seat-pad' | 'tote'
  pieces: SeedTemplatePiece[]
  seamCm: number
  labourMin: number
  fillCost: number
  active: boolean
}

export type SeedDefect = {
  key: string
  x: number
  y: number
  w: number
  h: number
}

export type SeedRemnant = {
  id: string
  title: string
  fabric: {name: string; maker: string; valuePerM: number}
  widthCm: number
  heightCm: number
  repeat?: {vCm: number; hCm: number}
  directional: boolean
  defects: SeedDefect[]
  ownerId: string
  status: 'intake' | 'consented' | 'listed' | 'allocated' | 'sold-out' | 'returned'
}

export const owners: SeedOwner[] = [
  {
    id: 'owner-01',
    name: 'Clara Morrow',
    email: 'clara.morrow@example.com',
    kind: 'client',
    shareBps: 2000,
  },
  {
    id: 'owner-02',
    name: 'Northlight Design Studio',
    email: 'studio@northlight.example.com',
    kind: 'designer',
    shareBps: 2200,
  },
  {
    id: 'owner-03',
    name: 'Loom & Line Workshop',
    email: 'hello@loomandline.example.com',
    kind: 'workshop',
    shareBps: 1800,
  },
  {
    id: 'owner-04',
    name: 'Juniper House',
    email: 'projects@juniperhouse.example.com',
    kind: 'client',
    shareBps: 2000,
  },
  {
    id: 'owner-05',
    name: 'Atelier Forty Two',
    email: 'contact@atelier42.example.com',
    kind: 'designer',
    shareBps: 2500,
  },
  {
    id: 'owner-06',
    name: 'Harbor & Hem Workshop',
    email: 'team@harborhem.example.com',
    kind: 'workshop',
    shareBps: 2000,
  },
]
export const templates: SeedTemplate[] = [
  {
    id: 'template-01',
    name: 'Square Cushion',
    kind: 'cushion',
    pieces: [
      {key: 'front', label: 'Front', wCm: 45, hCm: 45, qty: 1, centerPattern: true},
      {key: 'back', label: 'Back', wCm: 45, hCm: 45, qty: 2, centerPattern: false},
    ],
    seamCm: 3,
    labourMin: 45,
    fillCost: 18,
    active: true,
  },
  {
    id: 'template-02',
    name: 'Window Bench Pad',
    kind: 'bench-pad',
    pieces: [
      {key: 'top', label: 'Top', wCm: 110, hCm: 40, qty: 1, centerPattern: true},
      {key: 'bottom', label: 'Bottom', wCm: 110, hCm: 40, qty: 1, centerPattern: false},
      {key: 'boxing', label: 'Boxing', wCm: 110, hCm: 8, qty: 1, centerPattern: false},
    ],
    seamCm: 4,
    labourMin: 75,
    fillCost: 35,
    active: true,
  },
  {
    id: 'template-03',
    name: 'Lumbar Cushion',
    kind: 'lumbar',
    pieces: [
      {key: 'front', label: 'Front', wCm: 55, hCm: 30, qty: 1, centerPattern: true},
      {key: 'back', label: 'Back', wCm: 55, hCm: 30, qty: 2, centerPattern: false},
    ],
    seamCm: 3,
    labourMin: 38,
    fillCost: 14,
    active: true,
  },
  {
    id: 'template-04',
    name: 'Dining Seat Pad',
    kind: 'seat-pad',
    pieces: [
      {key: 'top', label: 'Top', wCm: 50, hCm: 50, qty: 1, centerPattern: true},
      {key: 'bottom', label: 'Bottom', wCm: 50, hCm: 50, qty: 1, centerPattern: false},
    ],
    seamCm: 3,
    labourMin: 32,
    fillCost: 12,
    active: true,
  },
  {
    id: 'template-05',
    name: 'Market Tote',
    kind: 'tote',
    pieces: [
      {key: 'body', label: 'Body', wCm: 38, hCm: 42, qty: 2, centerPattern: false},
      {key: 'gusset', label: 'Gusset', wCm: 12, hCm: 42, qty: 2, centerPattern: false},
      {key: 'pocket', label: 'Pocket', wCm: 22, hCm: 18, qty: 1, centerPattern: false},
    ],
    seamCm: 2,
    labourMin: 50,
    fillCost: 9,
    active: true,
  },
]

export const remnants: SeedRemnant[] = [
  {
    id: 'remnant-01',
    title: 'Midnight Fern',
    fabric: {name: 'Midnight Fern', maker: 'Hawthorne Textiles', valuePerM: 82},
    widthCm: 140,
    heightCm: 90,
    repeat: {vCm: 64, hCm: 32},
    directional: true,
    defects: [{key: 'defect-01', x: 116, y: 8, w: 10, h: 12}],
    ownerId: 'owner-02',
    status: 'listed',
  },
  {
    id: 'remnant-02',
    title: 'Ochre Boucle',
    fabric: {name: 'Ochre Boucle', maker: 'Merewether Mill', valuePerM: 64},
    widthCm: 120,
    heightCm: 80,
    directional: false,
    defects: [],
    ownerId: 'owner-01',
    status: 'listed',
  },
  {
    id: 'remnant-03',
    title: 'Cobalt Grid',
    fabric: {name: 'Cobalt Grid', maker: 'Field & Loom', valuePerM: 58},
    widthCm: 160,
    heightCm: 100,
    repeat: {vCm: 20, hCm: 20},
    directional: false,
    defects: [{key: 'defect-01', x: 14, y: 74, w: 18, h: 9}],
    ownerId: 'owner-03',
    status: 'listed',
  },
  {
    id: 'remnant-04',
    title: 'Rose Clay Stripe',
    fabric: {name: 'Rose Clay Stripe', maker: 'Merewether Mill', valuePerM: 72},
    widthCm: 90,
    heightCm: 70,
    repeat: {vCm: 30, hCm: 15},
    directional: true,
    defects: [{key: 'defect-01', x: 4, y: 46, w: 11, h: 8}],
    ownerId: 'owner-04',
    status: 'consented',
  },
  {
    id: 'remnant-05',
    title: 'Sage Herringbone',
    fabric: {name: 'Sage Herringbone', maker: 'Wren & Weft', valuePerM: 49},
    widthCm: 200,
    heightCm: 110,
    directional: true,
    defects: [{key: 'defect-01', x: 172, y: 19, w: 14, h: 16}],
    ownerId: 'owner-05',
    status: 'listed',
  },
  {
    id: 'remnant-06',
    title: 'Indigo Linen',
    fabric: {name: 'Indigo Linen', maker: 'Portland Cloth Co.', valuePerM: 38},
    widthCm: 75,
    heightCm: 60,
    directional: false,
    defects: [],
    ownerId: 'owner-06',
    status: 'intake',
  },
  {
    id: 'remnant-07',
    title: 'Moss Check',
    fabric: {name: 'Moss Check', maker: 'Hawthorne Textiles', valuePerM: 67},
    widthCm: 130,
    heightCm: 95,
    repeat: {vCm: 40, hCm: 40},
    directional: false,
    defects: [{key: 'defect-01', x: 94, y: 16, w: 12, h: 12}],
    ownerId: 'owner-01',
    status: 'consented',
  },
  {
    id: 'remnant-08',
    title: 'Paprika Velvet',
    fabric: {name: 'Paprika Velvet', maker: 'Cinder House', valuePerM: 91},
    widthCm: 105,
    heightCm: 85,
    repeat: {vCm: 25, hCm: 25},
    directional: true,
    defects: [{key: 'defect-01', x: 74, y: 59, w: 9, h: 10}],
    ownerId: 'owner-02',
    status: 'listed',
  },
  {
    id: 'remnant-09',
    title: 'Sandstone Weave',
    fabric: {name: 'Sandstone Weave', maker: 'Wren & Weft', valuePerM: 44},
    widthCm: 180,
    heightCm: 120,
    directional: false,
    defects: [
      {key: 'defect-01', x: 18, y: 18, w: 15, h: 11},
      {key: 'defect-02', x: 142, y: 86, w: 18, h: 13},
    ],
    ownerId: 'owner-03',
    status: 'listed',
  },
  {
    id: 'remnant-10',
    title: 'Ink Floral',
    fabric: {name: 'Ink Floral', maker: 'Cinder House', valuePerM: 76},
    widthCm: 140,
    heightCm: 90,
    repeat: {vCm: 50, hCm: 50},
    directional: true,
    defects: [{key: 'defect-01', x: 52, y: 9, w: 12, h: 12}],
    ownerId: 'owner-04',
    status: 'returned',
  },
  {
    id: 'remnant-11',
    title: 'Dune Stripe',
    fabric: {name: 'Dune Stripe', maker: 'Field & Loom', valuePerM: 53},
    widthCm: 220,
    heightCm: 100,
    repeat: {vCm: 30, hCm: 10},
    directional: true,
    defects: [],
    ownerId: 'owner-05',
    status: 'listed',
  },
  {
    id: 'remnant-12',
    title: 'Petrol Velvet',
    fabric: {name: 'Petrol Velvet', maker: 'Hawthorne Textiles', valuePerM: 88},
    widthCm: 60,
    heightCm: 50,
    directional: false,
    defects: [{key: 'defect-01', x: 8, y: 7, w: 7, h: 8}],
    ownerId: 'owner-06',
    status: 'intake',
  },
]
