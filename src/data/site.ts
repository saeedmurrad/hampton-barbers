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

// Prices are from the shop's 2022 price list and must be confirmed by the owner.
export type Item = { name: string; price: string; note: string };
export type Category = { name: string; items: Item[] };
export const menu: Category[] = [
  { name: 'Cuts', items: [
    { name: 'Gents Cut', price: '£14', note: 'Scissors or clippers, however you like it.' },
    { name: 'Skin Fade', price: '£16', note: 'Under 15s £13.' },
    { name: 'Gents Cut with Cut Throat', price: '£16', note: 'Edges finished with the razor.' },
    { name: 'Wash & Cut', price: '£18', note: 'Shampoo, cut and style.' },
    { name: 'Crew Cut', price: '£8', note: 'One grade all over.' },
  ] },
  { name: 'Beards', items: [
    { name: 'Beard Trim', price: '£8', note: 'Shaped, lined up and tidied.' },
  ] },
  { name: 'Family and concessions', items: [
    { name: 'Father & Son', price: '£18', note: 'Monday to Thursday in term time, child under 15.' },
    { name: 'Children 5–15', price: '£10', note: 'Under 5s £9.' },
    { name: 'Students 16–18', price: '£11', note: 'Bring your student ID.' },
    { name: 'Over 65s', price: '£9', note: 'Every day of the week.' },
  ] },
];

export const designs = [
  { id: 'heritage', name: 'Heritage', blurb: 'Traditional and centred, like a printed barber’s card. Charcoal and brass.' },
  { id: 'fresh', name: 'Fresh', blurb: 'Light and friendly. Rounded tiles that put hours, rating and address up front.' },
  { id: 'street', name: 'Street', blurb: 'Loud black-and-lime poster with giant type. Aimed at a younger crowd.' },
  { id: 'club', name: 'Club', blurb: 'Calm and upmarket. Green and cream, arched photos, a menu-style price list.' },
];
