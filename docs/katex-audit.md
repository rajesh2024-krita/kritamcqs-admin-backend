# Question Bank KaTeX Audit

The KaTeX audit module scans stored questions and persists one audit result per question in `QuestionKatexAuditResult`.

## Scanned Fields

- `question`
- `optionA`
- `optionB`
- `optionC`
- `optionD`
- `explanation`

## Statuses

- `PASS`: no detected issues.
- `WARNING`: notation or formatting issue detected.
- `FAILED`: high-risk parse issue such as unbalanced braces or delimiters.

Each result includes a `confidence` score from 0-100, issue details, review state, and proposed `fixedFields`.

## API

- `GET /admin/questions/katex-audit`
- `POST /admin/questions/katex-audit/scan`
- `POST /admin/questions/katex-audit/scan/:questionId`
- `POST /admin/questions/katex-audit/:questionId/auto-fix`
- `POST /admin/questions/katex-audit/bulk-auto-fix`
- `POST /admin/questions/katex-audit/mark-reviewed`
- `GET /admin/questions/katex-audit/export/csv`
- `GET /admin/questions/katex-audit/export/xlsx`

## Batch Processing

`scan` processes questions in batches, defaulting to 500 records per batch. This keeps scans bounded for large question banks.

## Auto-Fix Scope

Auto-fix applies conservative replacements for common OCR and plain-text formula cases, including chemical subscripts, ionic charges, scientific notation, simple exponents, simple numeric fractions, and common trigonometric commands. Every auto-fix updates the real `Question` document and re-runs the audit immediately.
