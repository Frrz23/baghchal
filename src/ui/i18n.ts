export type Lang = 'ne' | 'en';

type Dict = Record<string, string>;

const ne: Dict = {
  title: 'बाघचाल',
  subtitle: 'नेपालको राष्ट्रिय खेल',
  piecesLine: '४ बाघ · २० बाख्रा',
  modeAI: 'कम्प्युटरसँग खेल्नुहोस्',
  modeLocal: 'दुई जना खेल्नुहोस्',
  asGoat: 'बाख्रा खेल्नुहोस्',
  asTiger: 'बाघ खेल्नुहोस्',
  sidePick: 'कुन चाल खेल्ने?',
  back: 'पछाडि',
  turnGoat: 'बाख्राको चाल',
  turnTiger: 'बाघको चाल',
  inHand: 'बाँकी',
  captured: 'खाइएका',
  thinking: 'सोच्दै…',
  hintPlace: 'खाली ठाउँमा ट्याप गरेर बाख्रा राख्नुहोस्',
  hintSelect: 'आफ्नो टुक्रा छान्नुहोस्',
  hintMove: 'हरियो बिन्दुमा ट्याप गरेर चाल चल्नुहोस्',
  newGame: 'नयाँ खेल',
  menu: 'मेनु',
  goatWins: 'बाख्राले जित्यो!',
  tigerWins: 'बाघले जित्यो!',
  draw: 'बराबरी!',
  youWin: 'तपाईं जित्नुभयो!',
  youLose: 'तपाईं हार्नुभयो',
  rCaptures: '५ वटा बाख्रा खाइयो',
  rBlocked: 'सबै बाघ रोकिए',
  rLocked: 'सबै बाख्रा रोकिए',
  rRepeat: 'पोजिसन तेस्रो पटि दोहोरियो',
  goatEmoji: '🐐',
  tigerEmoji: '🐅',
  diffLabel: 'कम्प्युटरको कठिनाइ',
  diffEasy: 'सजिलो',
  diffMedium: 'मध्यम',
  diffHard: 'गाह्रो',
  undo: '↩ पछाडि',
  movesLabel: 'चालहरू',
  lastMove: 'अन्तिम चाल',
  paused: 'रोकियो',
  resume: 'खेल जारी राख्नुहोस्',
  reset: 'रिसेट गर्नुहोस्',
  langBtn: 'EN',
  place: 'राख्ने',
  step: 'चाल',
  capture: 'खाने',
};

const en: Dict = {
  title: 'Baghchal',
  subtitle: 'The national game of Nepal',
  piecesLine: '4 tigers · 20 goats',
  modeAI: 'Play vs computer',
  modeLocal: 'Two players (one phone)',
  asGoat: 'Play goats',
  asTiger: 'Play tigers',
  sidePick: 'Choose your side',
  back: 'Back',
  turnGoat: "Goat's move",
  turnTiger: "Tiger's move",
  inHand: 'In hand',
  captured: 'Captured',
  thinking: 'Thinking…',
  hintPlace: 'Tap an empty point to place a goat',
  hintSelect: 'Choose one of your pieces',
  hintMove: 'Tap a green point to move',
  newGame: 'New game',
  menu: 'Menu',
  goatWins: 'Goats win!',
  tigerWins: 'Tigers win!',
  draw: 'Draw!',
  youWin: 'You win!',
  youLose: 'You lose',
  rCaptures: 'Five goats were captured',
  rBlocked: 'All tigers are blocked',
  rLocked: 'All goats are locked',
  rRepeat: 'The position repeated three times',
  goatEmoji: '🐐',
  tigerEmoji: '🐅',
  diffLabel: 'Computer difficulty',
  diffEasy: 'Easy',
  diffMedium: 'Medium',
  diffHard: 'Hard',
  undo: '↩ Undo',
  movesLabel: 'Moves',
  lastMove: 'Last move',
  paused: 'Paused',
  resume: 'Resume',
  reset: 'Reset',
  langBtn: 'नेपाली',
  place: 'drop',
  step: 'move',
  capture: 'capture',
};

const dicts: Record<Lang, Dict> = { ne, en };

let current: Lang = (localStorage.getItem('lang') as Lang) || 'ne';

export function lang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  localStorage.setItem('lang', l);
}

export function t(key: string): string {
  return dicts[current][key] ?? key;
}

const DEV_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

export function num(n: number): string {
  const s = String(n);
  if (current !== 'ne') return s;
  let out = '';
  for (const ch of s) {
    const d = ch.charCodeAt(0) - 48;
    out += d >= 0 && d <= 9 ? DEV_DIGITS[d] : ch;
  }
  return out;
}
