import { createClient } from '@libsql/client';
import { setDb, db } from '../../server/db';
import { libsqlDatabase } from '../../server/academic/libsql';
import { initAcademicSchema } from '../../server/academic/schema';

export async function createAcademicFixture() {
  const client = createClient({ url: 'file::memory:' }); setDb(libsqlDatabase(client));
  await client.executeMultiple(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,student_id TEXT UNIQUE,dob TEXT,class_name TEXT,course_code TEXT,is_lecturer INTEGER DEFAULT 0,picture TEXT,phone TEXT,personal_email TEXT);
    CREATE TABLE lecturers(id INTEGER PRIMARY KEY,name TEXT,email TEXT,work_unit TEXT);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id INTEGER,recipient_email TEXT,type TEXT,subject TEXT,body TEXT,status TEXT,created_at TEXT,sent_at TEXT,read_at TEXT,error TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE advisor_assignments(id INTEGER PRIMARY KEY,user_id INTEGER,lecturer_id INTEGER,role TEXT,assigned_at TEXT);
    CREATE TABLE final_reports(id INTEGER PRIMARY KEY,user_id INTEGER,object_key TEXT,original_filename TEXT,file_size INTEGER,submitted_at TEXT,lecturer_comment TEXT);
    CREATE TABLE grades(id INTEGER PRIMARY KEY,user_id INTEGER,progress_score REAL,report_score REAL,company_score REAL,lecturer_id INTEGER,comment TEXT,locked_at TEXT,updated_at TEXT);
    CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT,description TEXT,slots INTEGER,address TEXT,contact_email TEXT);
    CREATE TABLE approved_company_names(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO settings VALUES('allowed_registration_cohorts','K66,K67,K68');
    INSERT INTO users(id,email,name,role) VALUES(1,'admin@vnu.edu.vn','Khoa','admin'),(2,'alpha@vnu.edu.vn','TS. Alpha','lecturer'),(3,'beta@vnu.edu.vn','TS. Beta','lecturer'),(4,'gamma@vnu.edu.vn','ThS. Gamma','lecturer');
    INSERT INTO lecturers VALUES(1,'TS. Alpha','alpha@vnu.edu.vn','Bộ môn A'),(2,'TS. Beta','beta@vnu.edu.vn','Bộ môn A'),(3,'ThS. Gamma','gamma@vnu.edu.vn','Bộ môn B'),(4,'CN. Delta','delta@vnu.edu.vn','Bộ môn A');
    INSERT INTO companies VALUES(1,'Công ty A','Công ty A',100,'Hà Nội','company@example.org');
    INSERT INTO approved_company_names VALUES(1,'Công ty A');
  `);
  await initAcademicSchema(db); return client;
}
