export const ANALYTICS_CATEGORIES = [
  {
    name: 'Vendor / Supplier Payments',
    color: '#3b82f6',
    ruleHint: 'PO in Comment'
  },
  {
    name: 'Salary & Social Insurance',
    color: '#10b981',
    ruleHint: 'Salaries, Bonus, Payroll, Social Insurance / مرتبات / تأمينات'
  },
  {
    name: 'Replenishments / Refund / Reimbursement',
    color: '#f59e0b',
    ruleHint: 'Replenishment, Refund, Reimbursement, Reimb'
  },
  {
    name: 'Tuition & Deposit Refunds (Student)',
    color: '#8b5cf6',
    ruleHint: 'Student ID or Tuition / Cap & Gown Refunds'
  },
  {
    name: 'Other / Unclassified',
    color: '#64748b',
    ruleHint: 'Account Funding, Non-PO Invoices & Empty Comments'
  }
]

export const CATEGORY_COLOR_MAP = ANALYTICS_CATEGORIES.reduce((acc, item) => {
  acc[item.name] = item.color
  return acc
}, {})

export const CATEGORY_HINT_MAP = ANALYTICS_CATEGORIES.reduce((acc, item) => {
  acc[item.name] = item.ruleHint
  return acc
}, {})

/**
 * Classifies a transaction into one of the standard Treasury expense types based on its Comment.
 * @param {string|null|undefined} comment
 * @returns {string}
 */
export function classifyTransactionComment(comment) {
  const raw = String(comment || '').trim()
  if (!raw) return 'Other / Unclassified'

  // 1. Vendor / Supplier Payments: comments referencing PO (excluding P.O. Box)
  if (
    /(?:^|[^a-z])p\.?\s*o\.?(?:[-\s#:/]*\d+|[^a-z]|$)/i.test(raw) &&
    !/\bp\.?\s*o\.?\s*box\b/i.test(raw)
  ) {
    return 'Vendor / Supplier Payments'
  }

  // 2. Tender / Bid-bond / Contract guarantee refunds -> Replenishments / Refund / Reimbursement
  // Checked before Social Insurance so Arabic "رد التأمين الابتدائي/النهائي" never misclassifies as Social Insurance.
  if (
    /(?:insurance\s*refund|رد\s*(?:ال)?ت[أا]مين|ت[أا]مين\s*(?:ال)?(?:ابتدائي|إبتدائي|نهائي)|خطاب\s*الضمان|\btender\b|\bbid\s*bond\b|\bperformance\s*bond\b)/i.test(raw)
  ) {
    if (/(?:refund|رد|ت[أا]مين)/i.test(raw)) {
      return 'Replenishments / Refund / Reimbursement'
    }
  }

  // 3. Salary & Social Insurance (Salaries, Payroll, Bonus, Social Insurance, مرتبات، تأمينات)
  if (
    /(?:\bsal(?:ary|aries)?\b|\bpayroll\b|\bbou?n[au]s\b|social\s*insur|soc\.?\s*ins|مرتب(?:ات)?|رواتب|[أا]جور|حوافز|مكاف[أئ]ة?|ت[أا]مينات|مص(?:اريف|روفات)\s*(?:ال)?ت[أا]مين|اشتراك\s*الت[أا]مين|معاشات)/i.test(raw)
  ) {
    return 'Salary & Social Insurance'
  }

  // 4. Tuition & Deposit Refunds (Student): comments with an NU Student ID (7-9 digits starting 14-29 or STU-xxxx)
  // or explicit Tuition / Student / Graduation gown keywords.
  const stripped = raw
    .replace(/\b(?:inv|invoice|je|bp|po|p\.o|tender|ref|nu)[-\s#:./]*\d+(?:[-/]\d+)*/gi, ' ')
    .replace(/\b\d{1,4}[-/.]\d{1,4}(?:[-/.]\d{2,4})?\b/g, ' ')

  const hasInvWord = /\binv(?:oice)?\b/i.test(raw)
  const hasStudentWords =
    /(?:tuition|titutione?|tution|cap\s*(?:and\s*|&\s*)?gown|work\s*study|\bstudent\b|رد\s*(?:ال)?مصاريف\s*(?:ال)?دراس|رد\s*مصاريف\s*(?:الطالب|متب?ي?ق))/i.test(raw)

  const hasStudentId =
    /\bstu[-_\s]*\d{4,9}\b/i.test(stripped) ||
    ((!hasInvWord || hasStudentWords || /refund|refun/i.test(raw)) &&
      /\b(?:1[4-9]|2[0-9])\d{5,7}\b/.test(stripped))

  if (hasStudentId || hasStudentWords) {
    return 'Tuition & Deposit Refunds (Student)'
  }

  // 5. Replenishments / Refund / Reimbursement / Reimb
  if (
    /(?:replen|r[ei]{2}mb|\briemb\b|\breim\b|refund|refun\s*deposit|refundeposit|استعاض|رد\s*مصاريف)/i.test(raw)
  ) {
    return 'Replenishments / Refund / Reimbursement'
  }

  return 'Other / Unclassified'
}

/**
 * Extracts Staff Employee ID or Student ID from a transaction Comment for auto-registering new beneficiaries.
 * @param {string|null|undefined} comment
 * @returns {{ category: string, employee_code: string|null }}
 */
export function extractPersonCodeFromComment(comment) {
  const raw = String(comment || '').trim()
  if (!raw) return { category: 'Operational', employee_code: null }

  // Staff / Salaries / Social Insurance ID extraction
  if (/(?:sal(?:ary|aries)?|\bpayroll\b|مرتب(?:ات)?|رواتب|ت[أا]مينات|مص(?:اريف|روفات)\s*(?:ال)?ت[أا]مين)/i.test(raw)) {
    const cleanCm = raw
      .replace(/\bje\s*[-#:]?\s*\d+/gi, ' ')
      .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')
    const idMatch = cleanCm.match(/\bID\b\s*[:#-]?\s*(\d{1,6})\b/i) || cleanCm.match(/[-–]\s*(\d{2,6})(?:\s|$|")/)
    if (idMatch && idMatch[1] && !/^20(1[89]|2[0-9])$/.test(idMatch[1])) {
      return { category: 'Staff', employee_code: idMatch[1] }
    }
  }

  // Student ID extraction (7-9 digit NU student ID)
  if (classifyTransactionComment(raw) === 'Tuition & Deposit Refunds (Student)') {
    const stripped = raw
      .replace(/\b(?:inv|invoice|je|bp|po|p\.o|tender|ref|nu)[-\s#:./]*\d+(?:[-/]\d+)*/gi, ' ')
      .replace(/\b\d{1,4}[-/.]\d{1,4}(?:[-/.]\d{2,4})?\b/g, ' ')
    const stuMatch = stripped.match(/\bstu[-_\s]*(\d{4,9})\b/i) || stripped.match(/\b((?:1[4-9]|2[0-9])\d{5,7})\b/)
    if (stuMatch && stuMatch[1]) {
      return { category: 'Students', employee_code: stuMatch[1] }
    }
  }

  return { category: 'Operational', employee_code: null }
}
