-- Authentication reads and academic joins use these expressions on API requests.
-- Non-unique indexes preserve the existing identity and admission rules.
CREATE INDEX IF NOT EXISTS idx_users_email_casefold ON users(lower(email));
CREATE INDEX IF NOT EXISTS idx_lecturers_email_casefold_trim ON lecturers(lower(trim(email)));
CREATE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);
CREATE INDEX IF NOT EXISTS idx_academic_enrollments_class ON academic_enrollments(class_id);
