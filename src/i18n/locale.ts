/** Supported UI languages. Const-map + union, per this project's no-TS-enum convention. */
export const Locale = { En: 'en', Ru: 'ru', Uk: 'uk', Pl: 'pl' } as const;
export type Locale = (typeof Locale)[keyof typeof Locale];
