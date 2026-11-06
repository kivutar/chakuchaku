# French store listing

Use the current fields in [store-listings/fr.json](store-listings/fr.json) for
the French App Store and Play Store localization. The shared description now
covers N5/N4, stories, learning in context, adaptive furigana, and Japanese audio.
The English equivalent is [store-listings/en.json](store-listings/en.json).

Use `shortDescription` on Google Play and `subtitle`, `promotionalText`, and
`keywords` on the App Store. Both stores use `name` and `description`. Validate
their respective field limits before saving. Full App Store descriptions are
updated with an editable app version; promotional text can also be updated on
the currently released version.

## Review notes

The French locale contains the same study sections and offline functionality as
the English locale. On a French device it is selected automatically; reviewers
can also choose `Français` under Settings → App language. AI autocorrection is
optional, disabled by default, and requires a reviewer-supplied OpenAI API key.
