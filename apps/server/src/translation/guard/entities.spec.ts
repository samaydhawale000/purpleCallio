import { canonicalNumber, extractEntities, normalizeDigits } from './entities';

describe('extractEntities', () => {
  it('returns empty lists for empty / non-string input', () => {
    const empty = {
      numbers: [],
      amounts: [],
      dates: [],
      times: [],
      phones: [],
      emails: [],
    };
    expect(extractEntities('')).toEqual(empty);
    expect(extractEntities(undefined as never)).toEqual(empty);
    expect(extractEntities('Hello, how are you?')).toEqual(empty);
  });

  it.each([
    ['Pay ₹2,50,000 today', '250000'],
    ['Pay 2.5 lakh today', '250000'],
    ['मुझे 2.5 लाख चाहिए', '250000'],
    ['Rs 250000 only', '250000'],
    ['Rs. 2,50,000/-', '250000'],
    ['INR 250000', '250000'],
    ['250000 rupees', '250000'],
    ['२,५०,००० रुपये', '250000'],
    ['mujhe 2.5 lakh ka loan chahiye', '250000'],
    ['1.2 crore', '12000000'],
    ['1.2 करोड़ का फ्लैट', '12000000'],
    ['3 कोटी रुपये', '30000000'],
    ['5 हज़ार', '5000'],
    ['5 हजार', '5000'],
    ['5 thousand', '5000'],
    ['5k budget', '5000'],
    ['2 million', '2000000'],
    ['1.5 billion', '1500000000'],
    ['$40', '40'],
    ['৫০০ টাকা', '500'],
    ['லட்சம்: 3 லட்சம்', '300000'],
    ['लाखों: 2 लाखों', '200000'],
  ])('amount %s → %s', (text, value) => {
    expect(extractEntities(text).amounts).toEqual([value]);
  });

  it('normalises digits from every Indic script and Arabic-Indic', () => {
    expect(normalizeDigits('०१२३४५६७८९')).toBe('0123456789');
    expect(normalizeDigits('০১২৩৪৫৬৭৮৯')).toBe('0123456789'); // Bengali
    expect(normalizeDigits('૦૧૨૩૪૫૬૭૮૯')).toBe('0123456789'); // Gujarati
    expect(normalizeDigits('੦੧੨੩੪੫੬੭੮੯')).toBe('0123456789'); // Gurmukhi
    expect(normalizeDigits('೦೧೨೩೪೫೬೭೮೯')).toBe('0123456789'); // Kannada
    expect(normalizeDigits('൦൧൨൩൪൫൬൭൮൯')).toBe('0123456789'); // Malayalam
    expect(normalizeDigits('୦୧୨୩୪୫୬୭୮୯')).toBe('0123456789'); // Odia
    expect(normalizeDigits('௦௧௨௩௪௫௬௭௮௯')).toBe('0123456789'); // Tamil
    expect(normalizeDigits('౦౧౨౩౪౫౬౭౮౯')).toBe('0123456789'); // Telugu
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789'); // Arabic-Indic
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789'); // Urdu
    expect(extractEntities('मेरे पास ४२ किताबें हैं').numbers).toEqual(['42']);
  });

  it('canonicalises plain numbers', () => {
    expect(canonicalNumber('2,50,000')).toBe('250000');
    expect(canonicalNumber('007')).toBe('7');
    expect(canonicalNumber('2.50')).toBe('2.5');
    expect(canonicalNumber('0')).toBe('0');
    expect(extractEntities('Order ORD12345 qty 2, v1.2.3').numbers).toEqual([
      '2',
    ]);
  });

  it.each([
    ['15% off', '15%'],
    ['15 percent', '15%'],
    ['15 प्रतिशत', '15%'],
    ['15 फ़ीसदी', '15%'],
    ['15 टक्के', '15%'],
  ])('percentage %s', (text, value) => {
    expect(extractEntities(text).numbers).toEqual([value]);
  });

  it.each([
    ['Due 22/10/2026', '2026-10-22'],
    ['Due 22-10-2026', '2026-10-22'],
    ['Due 22.10.2026', '2026-10-22'],
    ['Due 22/10/26', '2026-10-22'],
    ['Due 2026-10-22', '2026-10-22'],
    ['Due 22 Oct 2026', '2026-10-22'],
    ['Due 22nd October, 2026', '2026-10-22'],
    ['Due October 22, 2026', '2026-10-22'],
    ['Due Oct 22', '10-22'],
    ['Due 22 Oct', '10-22'],
    ['22 अक्टूबर 2026 तक', '2026-10-22'],
    ['22 ऑक्टोबर 2026 पर्यंत', '2026-10-22'],
    ['২২ অক্টোবর ২০২৬', '2026-10-22'],
    ['22 de octubre de 2026', '2026-10-22'],
  ])('date %s → %s', (text, value) => {
    expect(extractEntities(text).dates).toEqual([value]);
  });

  it('reads ambiguous numeric dates day-first except en-US', () => {
    expect(extractEntities('3/4/2026').dates).toEqual(['2026-04-03']);
    expect(extractEntities('3/4/2026', 'en-US').dates).toEqual(['2026-03-04']);
    expect(extractEntities('10/22/2026').dates).toEqual(['2026-10-22']);
    expect(extractEntities('22/10/2026', 'en-US').dates).toEqual([
      '2026-10-22',
    ]);
  });

  it('does not take short month words inside other words', () => {
    expect(extractEntities('मेरे 5 मेरे').dates).toEqual([]);
  });

  it.each([
    ['at 10:30', '10:30'],
    ['at 10.30 am', '10:30'],
    ['at 10:30 pm', '22:30'],
    ['at 5 pm', '17:00'],
    ['at 12 am', '00:00'],
    ['शाम 5 बजे', '05:00'],
    ['5 वाजता', '05:00'],
    ['kal 5 baje', '05:00'],
  ])('time %s → %s', (text, value) => {
    expect(extractEntities(text).times).toEqual([value]);
  });

  it.each([
    ['Call +91 98765 43210', '9876543210'],
    ['Call 98765-43210', '9876543210'],
    ['Call 9876543210', '9876543210'],
    ['Call 09876543210', '9876543210'],
    ['Call 919876543210', '9876543210'],
    ['Call 1800-123-4567', '18001234567'],
    ['फ़ोन ९८७६५ ४३२१०', '9876543210'],
  ])('phone %s → %s', (text, value) => {
    expect(extractEntities(text).phones).toEqual([value]);
  });

  it('does not treat lists of short numbers as phones', () => {
    const e = extractEntities('between 10 20 30 40 50');
    expect(e.phones).toEqual([]);
    expect(e.numbers).toEqual(['10', '20', '30', '40', '50']);
  });

  it('extracts emails (lower-cased) without leaking their digits', () => {
    const e = extractEntities('Mail Ravi.K42@Example.co.in please');
    expect(e.emails).toEqual(['ravi.k42@example.co.in']);
    expect(e.numbers).toEqual([]);
  });

  it('handles a mixed Hinglish sentence', () => {
    const e = extractEntities(
      'Sir aapka EMI ₹12,500 hai, 5 तारीख तक, call karo +91-98765-43210 pe, 22/10/2026 ko 10:30 baje',
    );
    expect(e.amounts).toEqual(['12500']);
    expect(e.phones).toEqual(['9876543210']);
    expect(e.dates).toEqual(['2026-10-22']);
    expect(e.times).toEqual(['10:30']);
    expect(e.numbers).toEqual(['5']);
  });

  it('dedupes repeated values', () => {
    expect(extractEntities('₹500 and Rs 500 and 500 rupees').amounts).toEqual([
      '500',
    ]);
  });
});
