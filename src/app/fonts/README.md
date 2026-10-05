# JetBrains Mono

The normal variable WOFF2 is vendored from the official JetBrains Mono repository
at commit `19371302b95d218af43299bce79ddbddd0bc364d`:

https://github.com/JetBrains/JetBrainsMono/blob/19371302b95d218af43299bce79ddbddd0bc364d/fonts/webfonts/JetBrainsMono%5Bwght%5D.woff2

The font is distributed under the SIL Open Font License 1.1, included in
`OFL.txt`. `next/font/local` serves it with the existing `--font-jetbrains-mono`
variable and weights 400–600. Bundling it avoids the Google Fonts CSS import
that failed in the Turbopack production build on CI.
