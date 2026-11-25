// All shop facts live here. Sources: the shop's Google profile, Facebook page and its 2022 website.
export const site = {
  name: 'Hampton Barbers',
  since: 2009,
  description:
    'Hampton Barbers is the walk-in barber shop in Hampton Vale, Peterborough. Skin fades, gents cuts, beard trims and kids cuts, seven days a week since 2009. No appointment needed.',
  phone: '01733 247848',
  phoneHref: 'tel:+441733247848',
  address: { street: '110 Four Chimneys Crescent', locality: 'Hampton Vale', city: 'Peterborough', postcode: 'PE7 8FH' },
  geo: { lat: 52.5325525, lng: -0.2769699 },
  mapsUrl: 'https://www.google.com/maps?cid=17490830983241398359',
  directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Hampton+Barbers%2C+110+Four+Chimneys+Crescent%2C+Peterborough+PE7+8FH',
  mapEmbed: 'https://www.google.com/maps?cid=17490830983241398359&output=embed',
  reviewsUrl: 'https://search.google.com/local/reviews?placeid=ChIJwYVzwAPxd0gRV_h_3hvqu_I',
  rating: { value: '4.2', count: 121 },
  facebook: 'https://www.facebook.com/people/Hampton-Barbers/100057483967806/',
  instagram: 'https://www.instagram.com/hamptonbarbers/',
  company: 'Hampton Barbers Ltd. Registered in England and Wales, company no. 07208206.',
  // day: 0 = Sunday. Times are 24h, Europe/London.
  hours: [
    { day: 1, label: 'Monday', short: 'Mon', open: '09:00', close: '20:00' },
    { day: 2, label: 'Tuesday', short: 'Tue', open: '09:00', close: '20:00' },
    { day: 3, label: 'Wednesday', short: 'Wed', open: '09:00', close: '20:00' },
    { day: 4, label: 'Thursday', short: 'Thu', open: '09:00', close: '20:00' },
    { day: 5, label: 'Friday', short: 'Fri', open: '09:00', close: '20:00' },
    { day: 6, label: 'Saturday', short: 'Sat', open: '08:00', close: '18:00' },
    { day: 0, label: 'Sunday', short: 'Sun', open: '10:00', close: '16:00' },
  ],
};

export const fmt = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
};

// Suggested prices based on typical Peterborough barber prices in late 2026. The owner must confirm them.
export type Item = { name: string; price: string; note: string };
export type Category = { name: string; items: Item[] };
export const menu: Category[] = [
  { name: 'Cuts', items: [
    { name: 'Gents Cut', price: '£17', note: 'A classic scissor or clipper cut. Tell us how you like the length and finish.' },
    { name: 'Skin Fade', price: '£20', note: 'A fade blended down to skin at the sides and back. Under 15s £16.' },
    { name: 'Gents Cut with Cut Throat', price: '£20', note: 'Edges finished with the razor.' },
    { name: 'Wash & Cut', price: '£22', note: 'Shampoo, cut and style.' },
    { name: 'Crew Cut', price: '£12', note: 'One grade all over.' },
  ] },
  { name: 'Beards', items: [
    { name: 'Beard Trim', price: '£10', note: 'Trim and shape the beard, with a tidy outline.' },
    { name: 'Cut & Beard', price: '£26', note: 'Any haircut plus a beard trim and line-up.' },
  ] },
  { name: 'Family and concessions', items: [
    { name: 'Father & Son', price: '£30', note: 'Monday to Thursday in term time, child under 15.' },
    { name: 'Children 5–15', price: '£13', note: 'Under 5s £11.' },
    { name: 'Students 16–18', price: '£15', note: 'Bring your student ID.' },
    { name: 'Over 65s', price: '£12', note: 'Every day of the week.' },
  ] },
];

// Example photos for each style (free Unsplash licence, not taken at Hampton Barbers).
export type Style = { key: string; name: string; tags: string[]; blurb: string; by: string; byUrl: string; pos?: string };
export const styles: Style[] = [
  { key: 'skin-fade', name: 'Skin Fade', tags: ['Fades'], blurb: 'Faded down to the skin at the back and sides, blending into length on top.', by: 'Victor Sirbu', byUrl: 'https://unsplash.com/@victorsirbu04', pos: '50% 35%' },
  { key: 'textured-fade', name: 'Textured Fade', tags: ['Fades'], blurb: 'A fade with choppy, textured length on top. Styles in seconds with a little clay.', by: 'Langanis Studio', byUrl: 'https://unsplash.com/@langanisstudio', pos: '45% 40%' },
  { key: 'afro-taper', name: 'Taper on Curly Hair', tags: ['Fades'], blurb: 'A clean taper at the sides that keeps natural curls full on top.', by: 'Obi', byUrl: 'https://unsplash.com/@obionyeador', pos: '50% 45%' },
  { key: 'crew-cut', name: 'Crew Cut', tags: ['Fades'], blurb: 'Short and neat all round, a touch longer on top. Always tidy, no effort.', by: 'Mitchell Orr', byUrl: 'https://unsplash.com/@mitchorr', pos: '55% 35%' },
  { key: 'short-back-sides', name: 'Short Back and Sides', tags: ['Scissor cuts'], blurb: 'The British classic: short and clean round the ears, length kept on top.', by: 'Stephan Louis', byUrl: 'https://unsplash.com/@stephanlouis', pos: '50% 22%' },
  { key: 'textured-crop', name: 'Textured Crop', tags: ['Scissor cuts'], blurb: 'Short fringe pushed forward with lots of texture. Low on upkeep.', by: 'Thomas Marquize', byUrl: 'https://unsplash.com/@tomarquize', pos: '50% 25%' },
  { key: 'quiff', name: 'Quiff', tags: ['Scissor cuts'], blurb: 'Short sides with volume swept up and back at the front.', by: 'Damian Barczak', byUrl: 'https://unsplash.com/@barczakshoots', pos: '50% 25%' },
  { key: 'pompadour', name: 'Slick Back', tags: ['Scissor cuts'], blurb: 'Longer on top and combed back, finished with scissors and comb.', by: 'André Reis', byUrl: 'https://unsplash.com/@andrereispt', pos: '55% 30%' },
  { key: 'beard-sculpt', name: 'Beard Shape-Up', tags: ['Beards & shaves'], blurb: 'Sharp cheek and neck lines on a full beard, matched to your fade.', by: 'Ahmad Ebadi', byUrl: 'https://unsplash.com/@ebadi__ahmad', pos: '50% 30%' },
  { key: 'beard-trim', name: 'Beard Trim', tags: ['Beards & shaves'], blurb: 'Length taken down and tidied with scissors and clippers.', by: 'Mr Shave', byUrl: 'https://unsplash.com/@mrshave', pos: '50% 30%' },
  { key: 'cut-throat-shave', name: 'Cut-Throat Finish', tags: ['Beards & shaves'], blurb: 'Edges finished with a straight razor for the crispest line.', by: 'Antonio Reynoso', byUrl: 'https://unsplash.com/@infantleon', pos: '50% 40%' },
  { key: 'kids-cut', name: 'Kids Cut', tags: ['Kids'], blurb: 'Patient barbers and a smart cut for school, from under 5s upwards.', by: 'Ibrahim Guetar', byUrl: 'https://unsplash.com/@himo_beast1996', pos: '50% 30%' },
];

// Customer reviews. Word-for-word quotes from Google reviews that the shop showed on its
// own 2022 website, plus one recent Google review. Names shortened to first name and initial.
export const reviews = [
  { text: 'Been going here since I was 7 years old, 25 now.', name: 'Google review' },
  { text: 'Never been anywhere else since… excellent service.', name: 'Simon W.' },
  { text: 'Does both my sons hairs amazing! He’s very patient and polite also.', name: 'Emma C.' },
  { text: 'Very friendly and professional service. Staff are well trained and well mannered.', name: 'Hansley M.' },
  { text: 'Very good barbers. Went for a beard trim and service was outstanding.', name: 'Grant M.' },
  { text: 'Friendly efficient staff.', name: 'Ioannis D.' },
];

// Style photos for each design (free Unsplash licence). Fresh uses the credits in `styles` above.
export const styleShots: Record<string, Record<string, { by: string; byUrl: string }>> = {
  "heritage": {
    "skin-fade": {
      "by": "Agustin Fernandez",
      "byUrl": "https://unsplash.com/@agustinfernandez"
    },
    "textured-fade": {
      "by": "Megan Bagshaw",
      "byUrl": "https://unsplash.com/@megbagshaw"
    },
    "afro-taper": {
      "by": "Gulom Nazarov",
      "byUrl": "https://unsplash.com/@modelyano"
    },
    "crew-cut": {
      "by": "Behrouz Sasani",
      "byUrl": "https://unsplash.com/@behrouzsasani"
    },
    "short-back-sides": {
      "by": "Hannah Skelly",
      "byUrl": "https://unsplash.com/@ivelisseskelly"
    },
    "textured-crop": {
      "by": "Matheus Farias",
      "byUrl": "https://unsplash.com/@karmatheux"
    },
    "quiff": {
      "by": "John T.",
      "byUrl": "https://unsplash.com/@shamstopu"
    },
    "pompadour": {
      "by": "Alex Sheldon",
      "byUrl": "https://unsplash.com/@slavewire"
    },
    "beard-sculpt": {
      "by": "Lesly Juarez",
      "byUrl": "https://unsplash.com/@jblesly"
    },
    "beard-trim": {
      "by": "Nathon Oski",
      "byUrl": "https://unsplash.com/@onatecan"
    },
    "cut-throat-shave": {
      "by": "Arthur Humeau",
      "byUrl": "https://unsplash.com/@_aaarthy"
    },
    "kids-cut": {
      "by": "Tommy van Kessel",
      "byUrl": "https://unsplash.com/@tommyvankessel"
    }
  },
  "street": {
    "skin-fade": {
      "by": "Tá Focando",
      "byUrl": "https://unsplash.com/@tafocandofotoefilme"
    },
    "textured-fade": {
      "by": "Hesam Link",
      "byUrl": "https://unsplash.com/@hesamjr"
    },
    "afro-taper": {
      "by": "John Arano",
      "byUrl": "https://unsplash.com/@johnarano"
    },
    "crew-cut": {
      "by": "Behrooz Rahimi",
      "byUrl": "https://unsplash.com/@behroozrahimi"
    },
    "short-back-sides": {
      "by": "Amir Javadzadeh",
      "byUrl": "https://unsplash.com/@awmirjim"
    },
    "textured-crop": {
      "by": "Megan Bagshaw",
      "byUrl": "https://unsplash.com/@megbagshaw"
    },
    "quiff": {
      "by": "Le Thanh Son",
      "byUrl": "https://unsplash.com/@notoriousfan3012"
    },
    "pompadour": {
      "by": "Laszlo Barta",
      "byUrl": "https://unsplash.com/@slie_design"
    },
    "beard-sculpt": {
      "by": "Behrouz Sasani",
      "byUrl": "https://unsplash.com/@behrouzsasani"
    },
    "beard-trim": {
      "by": "César Badilla Miranda",
      "byUrl": "https://unsplash.com/@xbmpro"
    },
    "cut-throat-shave": {
      "by": "Allef Vinicius",
      "byUrl": "https://unsplash.com/@seteph"
    },
    "kids-cut": {
      "by": "Kawê Rodrigues",
      "byUrl": "https://unsplash.com/@kawerodriguess"
    }
  },
  "club": {
    "skin-fade": {
      "by": "Salah Regouane",
      "byUrl": "https://unsplash.com/@salaheregouane"
    },
    "textured-fade": {
      "by": "Megan Bagshaw",
      "byUrl": "https://unsplash.com/@megbagshaw"
    },
    "afro-taper": {
      "by": "Luke Thornton",
      "byUrl": "https://unsplash.com/@lukethorntonofficial"
    },
    "crew-cut": {
      "by": "Or Hakim",
      "byUrl": "https://unsplash.com/@orhakim"
    },
    "short-back-sides": {
      "by": "Nathan Fertig",
      "byUrl": "https://unsplash.com/@nathanfertig"
    },
    "textured-crop": {
      "by": "Thomas Marquize",
      "byUrl": "https://unsplash.com/@tomarquize"
    },
    "quiff": {
      "by": "Bojan Mano",
      "byUrl": "https://unsplash.com/@bojandubov"
    },
    "pompadour": {
      "by": "Alex Sheldon",
      "byUrl": "https://unsplash.com/@slavewire"
    },
    "beard-sculpt": {
      "by": "Eugene Chystiakov",
      "byUrl": "https://unsplash.com/@eugenechystiakov"
    },
    "beard-trim": {
      "by": "Mitchell Orr",
      "byUrl": "https://unsplash.com/@mitchorr"
    },
    "cut-throat-shave": {
      "by": "Victor Sirbu",
      "byUrl": "https://unsplash.com/@victorsirbu04"
    },
    "kids-cut": {
      "by": "Tommy van Kessel",
      "byUrl": "https://unsplash.com/@tommyvankessel"
    }
  }
};

// Opening and about photos for each design (free Unsplash licence). Shop photos are the shop's own.
export const pageCredits: Record<string, { by: string; byUrl: string }[]> = {
  "heritage": [
    {
      "by": "Redd Francisco",
      "byUrl": "https://unsplash.com/@reddfrancisco"
    },
    {
      "by": "André Reis",
      "byUrl": "https://unsplash.com/@andrereispt"
    },
    {
      "by": "Andrea Donato",
      "byUrl": "https://unsplash.com/@andreadonato"
    }
  ],
  "street": [
    {
      "by": "Agustin Fernandez",
      "byUrl": "https://unsplash.com/@agustinfernandez"
    }
  ],
  "fresh": [
    {
      "by": "Michael DeMoya",
      "byUrl": "https://unsplash.com/@demoya"
    }
  ],
  "club": [
    {
      "by": "Reza Ghaemi",
      "byUrl": "https://unsplash.com/@irezaghaemi"
    },
    {
      "by": "Jonathan Cooper",
      "byUrl": "https://unsplash.com/@theshuttervision"
    },
    {
      "by": "André Reis",
      "byUrl": "https://unsplash.com/@andrereispt"
    }
  ]
};

// The owner's three shops. Keys match the live-status keys in src/lib/live.ts.
// Demo: Hampton Vale's key is the design name; the other two are placeholders until the
// owner confirms their names and addresses.
export const shops = [
  { id: 'hampton-vale', name: 'Hampton Vale', place: '110 Four Chimneys Crescent', directionsUrl: site.directionsUrl },
  { id: 'shop-2', name: 'Shop two', place: 'Name and address to come', directionsUrl: '' },
  { id: 'shop-3', name: 'Shop three', place: 'Name and address to come', directionsUrl: '' },
];

export const designs = [
  { id: 'heritage', name: 'Heritage', blurb: 'Old-fashioned barber’s card: centred, charcoal and brass, framed photo plates and slow ink-like motion.' },
  { id: 'fresh', name: 'Fresh', blurb: 'Bright and friendly: bold photos, a filterable style gallery, bouncy pop-in motion.' },
  { id: 'street', name: 'Street', blurb: 'Loud black-and-lime poster: giant type, hard wipes, a hover-to-reveal style list.' },
  { id: 'club', name: 'Club', blurb: 'Calm and upmarket: green and cream, arched lookbook photos, soft slow focus-in motion.' },
];
