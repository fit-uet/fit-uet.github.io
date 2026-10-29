-- Authentication reads use these expressions on every API request.
-- Non-unique indexes preserve the existing identity and admission rules.
CREATE INDEX IF NOT EXISTS idx_users_email_casefold ON users(lower(email));
CREATE INDEX IF NOT EXISTS idx_lecturers_email_casefold_trim ON lecturers(lower(trim(email)));
