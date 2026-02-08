// Habbo avatar figure string components
// Format: partType-partId-colorId.partType-partId-colorId...

// Body parts breakdown:
// hr = hair, hd = head/face, ch = chest/shirt, lg = legs/pants
// sh = shoes, fa = face accessory, ca = coat/jacket, ha = hat
// he = head accessory, wa = waist accessory, ea = eye accessory

const HAIR_STYLES = [
  'hr-100', 'hr-105', 'hr-110', 'hr-115', 'hr-125', 'hr-130',
  'hr-135', 'hr-145', 'hr-150', 'hr-155', 'hr-160', 'hr-165',
  'hr-170', 'hr-175', 'hr-180', 'hr-185', 'hr-190', 'hr-195',
  'hr-500', 'hr-505', 'hr-515', 'hr-525', 'hr-535', 'hr-545',
  'hr-560', 'hr-570', 'hr-580', 'hr-590', 'hr-600', 'hr-605',
];

const HAIR_COLORS = [
  '-40', '-42', '-44', '-46', '-48', '-50', '-52', '-54',
  '-56', '-58', '-60', '-62', '-31', '-33', '-35', '-37',
];

const HEAD_STYLES = [
  'hd-180', 'hd-185', 'hd-190', 'hd-195', 'hd-200', 'hd-205',
  'hd-600', 'hd-605', 'hd-610', 'hd-615', 'hd-620', 'hd-625',
];

const SKIN_COLORS = [
  '-1', '-2', '-3', '-4', '-5', '-6', '-7', '-8', '-9', '-10',
  '-11', '-12', '-13', '-14',
];

const CHEST_STYLES = [
  'ch-210', 'ch-215', 'ch-220', 'ch-225', 'ch-230', 'ch-235',
  'ch-240', 'ch-245', 'ch-250', 'ch-255', 'ch-260', 'ch-265',
  'ch-3030', 'ch-3035', 'ch-3040', 'ch-3050', 'ch-3060', 'ch-3070',
  'ch-3110', 'ch-3120', 'ch-3130', 'ch-3140', 'ch-3150', 'ch-3160',
];

const CHEST_COLORS = [
  '-62', '-64', '-66', '-68', '-70', '-72', '-74', '-76',
  '-78', '-80', '-82', '-84', '-86', '-88', '-90', '-92',
  '-1408', '-1410', '-1412', '-1414', '-1416', '-1418',
];

const LEGS_STYLES = [
  'lg-270', 'lg-275', 'lg-280', 'lg-285', 'lg-290', 'lg-295',
  'lg-300', 'lg-305', 'lg-3010', 'lg-3020', 'lg-3030', 'lg-3040',
  'lg-3050', 'lg-3060', 'lg-3070', 'lg-3080', 'lg-3090', 'lg-3100',
];

const LEGS_COLORS = [
  '-62', '-64', '-66', '-68', '-70', '-72', '-74', '-76',
  '-78', '-80', '-82', '-1408', '-1410', '-1412',
];

const SHOES_STYLES = [
  'sh-290', 'sh-295', 'sh-300', 'sh-305', 'sh-725', 'sh-730',
  'sh-735', 'sh-740', 'sh-3010', 'sh-3020', 'sh-3030',
];

const SHOES_COLORS = [
  '-62', '-64', '-66', '-68', '-70', '-72', '-80', '-92',
];

// Optional accessories (30% chance each)
const FACE_ACCESSORIES = [
  'fa-1201', 'fa-1202', 'fa-1203', 'fa-1204', 'fa-1205', 'fa-1206',
  'fa-1207', 'fa-1208', 'fa-1209', 'fa-1210', 'fa-1211', 'fa-1212',
];

const COAT_ACCESSORIES = [
  'ca-1801', 'ca-1802', 'ca-1803', 'ca-1804', 'ca-1805', 'ca-1806',
  'ca-1807', 'ca-1808', 'ca-1809', 'ca-1810',
];

const COAT_COLORS = [
  '-62', '-64', '-66', '-68', '-70', '-72', '-74', '-76',
];

const HAT_ACCESSORIES = [
  'ha-1001', 'ha-1002', 'ha-1003', 'ha-1004', 'ha-1005',
  'ha-1006', 'ha-1007', 'ha-1008', 'ha-1009', 'ha-1010',
  'ha-1011', 'ha-1012', 'ha-1013', 'ha-1014',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateFigure(): string {
  const parts: string[] = [];

  // Required parts
  parts.push(pick(HAIR_STYLES) + pick(HAIR_COLORS));
  parts.push(pick(HEAD_STYLES) + pick(SKIN_COLORS));
  parts.push(pick(CHEST_STYLES) + pick(CHEST_COLORS));
  parts.push(pick(LEGS_STYLES) + pick(LEGS_COLORS));
  parts.push(pick(SHOES_STYLES) + pick(SHOES_COLORS));

  // Optional accessories
  if (Math.random() < 0.3) {
    parts.push(pick(FACE_ACCESSORIES));
  }
  if (Math.random() < 0.25) {
    parts.push(pick(COAT_ACCESSORIES) + pick(COAT_COLORS));
  }
  if (Math.random() < 0.2) {
    parts.push(pick(HAT_ACCESSORIES));
  }

  return parts.join('.');
}

export function generateGender(): 'M' | 'F' {
  return Math.random() < 0.5 ? 'M' : 'F';
}
