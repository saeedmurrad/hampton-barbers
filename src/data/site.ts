// All shop facts live here. Sources: the shop's Google profile, Facebook page and its 2022 website.
export const site = {
  name: 'Hampton Barbers',
  since: 2009,
  tagline: 'Walk-in barbers in the heart of Hampton Vale',
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
  rating: { value: '4.2', count: 121, source: 'Google' },
  facebook: 'https://www.facebook.com/people/Hampton-Barbers/100057483967806/',
  instagram: 'https://www.instagram.com/hamptonbarbers/',
  company: 'Hampton Barbers Ltd. Registered in England and Wales, company no. 07208206.',
  // day: 0 = Sunday. Times are 24h, Europe/London.
  hours: [
    { day: 1, label: 'Monday', open: '09:00', close: '20:00' },
    { day: 2, label: 'Tuesday', open: '09:00', close: '20:00' },
    { day: 3, label: 'Wednesday', open: '09:00', close: '20:00' },
    { day: 4, label: 'Thursday', open: '09:00', close: '20:00' },
    { day: 5, label: 'Friday', open: '09:00', close: '20:00' },
    { day: 6, label: 'Saturday', open: '08:00', close: '18:00' },
    { day: 0, label: 'Sunday', open: '10:00', close: '16:00' },
  ],
};

// Prices are from the shop's 2022 price list and must be confirmed by the owner.
export const services = [
  { name: 'Gents Cut', price: '£14', note: 'Scissor or clipper cut, finished properly.' },
  { name: 'Skin Fade', price: '£16', note: 'Sharp, clean blend. Under 15s £13.' },
  { name: 'Gents Cut with Cut Throat', price: '£16', note: 'Razor-finished edges for a crisp line.' },
  { name: 'Wash & Cut', price: '£18', note: 'Shampoo, cut and style.' },
  { name: 'Beard Trim', price: '£8', note: 'Shaped, lined and tidied.' },
  { name: 'Crew Cut', price: '£8', note: 'One grade all over.' },
  { name: 'Father & Son', price: '£18', note: 'Monday to Thursday in term time, child under 15.' },
  { name: 'Children 5–15', price: '£10', note: 'Patient barbers, happy kids. Under 5s £9.' },
  { name: 'Students 16–18', price: '£11', note: 'Bring your student ID.' },
  { name: 'Over 65s', price: '£9', note: 'A proper cut at a fair price.' },
];

export const themes = [
  { id: 'heritage', name: 'Heritage', blurb: 'Charcoal and brass. Classic gentleman’s barber.', swatch: ['#12100e', '#c9a25d', '#f3ead9'] },
  { id: 'fresh', name: 'Fresh', blurb: 'Light, clean and modern with a red accent.', swatch: ['#f6f1e7', '#d6402b', '#16130f'] },
  { id: 'street', name: 'Street', blurb: 'Black, bold type and electric lime.', swatch: ['#0a0a0c', '#c8f542', '#ffffff'] },
  { id: 'club', name: 'Club', blurb: 'Deep green, cream and copper.', swatch: ['#0f2a22', '#d98a4e', '#f4ecdc'] },
];
