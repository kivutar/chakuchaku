# Generated voices

Lesson narration lives in `grammar/`; reusable word pronunciation lives in
`vocab/`. Reading sentences live in `reading/`; grammar exercises borrowing them
reuse those same files. Run `npm run voices -- --target reading --limit COUNT`
to generate reading audio. The normal lesson target excludes borrowed sentences
to avoid duplicate generation and preserve reading retry exclusions.

Run `npm run voices` for lessons or `npm run voices:vocabulary --
--limit COUNT` for a bounded vocabulary batch. Raw WAV files are development
artifacts and are intentionally ignored by Git. Vocabulary files normally use
their rōmaji reading; homophones add a curated semantic suffix.
