// Single source of truth for every rig/unit dropdown across the app.
// Update here — all screens (Dashboard filter, PO form, Logistics, Rig, Admin) pick it up automatically.
export const PO_RIG_OPTIONS = [
  'Discovery 1',
  'Virtue 1',
  'Jindal Star',
  'Jindal Explorer',
  'Jindal Pioneer',
  'Jindal Supreme',
  'Discovery 1 DD',
  'Virtue 1 DD',
  'Jindal Star DD',
  'Jindal Explorer DD',
  'Jindal Pioneer DD',
  'Jindal Supreme DD',
  'Directional Drilling',
  'MLU',
  'BKC',
  'Taloja',
  'Nagothane',
  'Nhava',
]

// Alias — always mirrors PO_RIG_OPTIONS so legacy imports keep working
export const RIG_NAMES = PO_RIG_OPTIONS

export const BUYER_CODES = [
  'AP-31', 'RT-13', 'MP', 'MB-42', 'DC-22',
  'PM-29', 'AD-44', 'AC-36', 'UN-45', 'MC-38',
]

export const LOGISTICS_CODES = [
  'SV-01', 'SS-02', 'AK-03', 'KT-04', 'MK-05', 'RS-06',
]

export const DELIVERY_MODES = ['Vendor Delivery', 'JDIL Pickup']

// Mode of Transport — CHANGE 4 (OSV / CCB / CCC / Road-Courier)
export const TRANSPORT_MODES = ['OSV', 'CCB', 'CCC', 'Road/Courier']

// Dispatch location (5 options incl. Rig) — used for Material Dispatch Location
export const LOCATION_OPTIONS = ['BKC', 'Taloja', 'Nagothane', 'Nhava', 'Rig']

// Received location (4 hub options, NO Rig) — used for Material Received Location
export const LOCATION_OPTIONS_NO_RIG = ['BKC', 'Taloja', 'Nagothane', 'Nhava']

// Rig "Remarks" dropdown options (CHANGE 7) — free-text details go in Other Remarks
export const RIG_REMARKS_OPTIONS = [
  'Full Material Received',
  'Partial Material Received',
  'Material Received PO/DC yet to Receive',
  'Quality Issue',
  'Wrong Supply',
  'Short Supply',
  'Received in Damaged Condition',
  'Others',
]

export const ROLES = ['purchase', 'logistics', 'rig', 'admin', 'csuite']

export const PO_STATUSES = [
  'MR Created',
  'PO Released',
  'Buyer Assigned',
  'Vendor Confirmed',
  'At JDIL Location',
  'Dispatched from JDIL',
  'In Transit to JDIL',
  'In Transit to Rig',
  'Delivered to Rig',
]

export const STATUS_COLORS = {
  'MR Created':               'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  'PO Released':              'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'Buyer Assigned':           'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'Vendor Confirmed':         'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'In Transit to JDIL':       'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'At JDIL Location':         'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  'Dispatched from JDIL':     'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'In Transit to Rig':        'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  'Delivered to Rig':         'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

export const RIG_COORDINATES = {
  // Base rigs
  'Discovery 1':       [19.0760, 72.8777],
  'Virtue 1':          [20.1500, 72.9500],
  'Jindal Star':       [18.5204, 73.8567],
  'Jindal Explorer':   [21.1458, 79.0882],
  'Jindal Pioneer':    [22.3072, 73.1812],
  'Jindal Supreme':    [19.9975, 73.7898],
  // DD variants (slight offsets from parent so they don't overlap)
  'Discovery 1 DD':    [19.0660, 72.8677],
  'Virtue 1 DD':       [20.1400, 72.9400],
  'Jindal Star DD':    [18.5104, 73.8467],
  'Jindal Explorer DD':[21.1358, 79.0782],
  'Jindal Pioneer DD': [22.2972, 73.1712],
  'Jindal Supreme DD': [19.9875, 73.7798],
  // Support units
  'Directional Drilling': [19.0860, 72.8877],
  'MLU':               [19.0896, 72.8656],
}

export const HUB_COORDINATES = {
  'BKC':       [19.0659, 72.8659],
  'Taloja':    [19.0176, 73.0724],
  'Nagothane': [18.5437, 73.1398],
  'Nhava':     [18.9388, 72.9518],
}

export const OVERDUE_DAYS = 45
