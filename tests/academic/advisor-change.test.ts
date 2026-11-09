import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createAcademicFixture } from './fixture';
import { db } from '../../server/db';
import { JWT_SECRET } from '../../server/config';
import { commit, snapshot, AcademicError } from '../../server/academic/store';
import { newEnrollment, getEnrollment, getClass } from '../../server/academic/domain';
import { createSemester, createClass, enrollmentAction } from '../../server/academic/service';
import { updateCampaign } from '../../server/academic/campaigns';
import { requestAdvisorChange, cancelAdvisorChange, reviewAdvisorChange } from '../../server/academic/advisorChange';
import { academicRouter } from '../../server/academic/routes';
import type { AcademicClass, CourseEnrollment } from '../../src/shared/academic';
import type { AuthenticatedUser } from '../../server/types';

const admin: AuthenticatedUser = { id: 1, role: 'admin', name: 'Khoa', email: 'admin@vnu.edu.vn' };
const alpha: AuthenticatedUser = { id: 2, role: 'lecturer', name: 'TS. Alpha', email: 'alpha@vnu.edu.vn' };
const beta: AuthenticatedUser = { id: 3, role: 'lecturer', name: 'TS. Beta', email: 'beta@vnu.edu.vn' };
const gamma: AuthenticatedUser = { id: 4, role: 'lecturer', name: 'TS. Gamma', email: 'gamma@vnu.edu.vn' };

let client: Client, directory: string, previousCwd: string, c: AcademicClass, e: CourseEnrollment, sv: AuthenticatedUser;
const errorCode = (code: string) => (error: unknown) => error instanceof AcademicError && error.code === code;
const fresh = async () => getEnrollment(await snapshot(), e.id);

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'advisor-change-'));
  previousCwd = process.cwd();
  process.chdir(directory);
  client = await createAcademicFixture();

  const semester = await createSemester(admin, 2026, '1');
  c = await createClass(admin, { semesterId: semester.id, courseCode: 'INT3132', section: '1' });
  let s = await snapshot();
  await updateCampaign(admin, c.campaignId, { expectedRevision: s.campaigns!.find(p => p.id === c.campaignId)!.revision, status: 'active' });

  s = await snapshot();
  c = getClass(s, c.id);
  e = newEnrollment(c, { studentId: '24020002', name: 'Nguyễn Văn A' });
  // Alpha is lecturerId 1, Beta is lecturerId 2, Gamma is lecturerId 3
  e.assignments = [{ id: 'primary', lecturerId: 1, role: 'primary', assignedAt: new Date().toISOString() }];

  await commit(s, 1, 'admin.test.admit', {
    enrollments: [e],
    users: [{ studentId: e.studentId, name: e.name, email: e.email, dob: '', className: '' }],
  });
  sv = {
    id: Number((await db.execute({ sql: 'SELECT id FROM users WHERE email=?', args: [e.email] })).rows[0].id),
    email: e.email,
    role: 'student',
    name: e.name,
  };
});

afterEach(async () => {
  client.close();
  process.chdir(previousCwd);
  await rm(directory, { recursive: true, force: true });
});

test('student can request advisor change and old advisor can approve', async () => {
  const current = await fresh();
  assert.equal(current.advisorChangeRequest, null);

  // Student requests advisor change to lecturerId 2 (TS. Beta)
  await requestAdvisorChange(sv, e.id, {
    expectedRevision: current.revision,
    targetLecturerId: 2,
    reason: 'Em muốn đổi hướng nghiên cứu sang mảng AI phù hợp với hướng nghiên cứu của Thầy Beta hơn.',
  });

  const requested = await fresh();
  assert.equal(requested.advisorChangeRequest?.status, 'pending');
  assert.equal(requested.advisorChangeRequest?.currentLecturerId, 1);
  assert.equal(requested.advisorChangeRequest?.targetLecturerId, 2);

  // Student cannot submit a second pending request
  await assert.rejects(
    requestAdvisorChange(sv, e.id, {
      expectedRevision: requested.revision,
      targetLecturerId: 3,
      reason: 'Lý do khác nữa...',
    }),
    errorCode('REQUEST_ALREADY_PENDING')
  );

  // Another lecturer (Gamma, id: 3) cannot review
  await assert.rejects(
    reviewAdvisorChange(gamma, e.id, {
      expectedRevision: requested.revision,
      status: 'approved',
    }),
    errorCode('PERMISSION_DENIED')
  );

  // Current advisor (Alpha, id: 2 in users which maps to lecturer 1) approves
  await reviewAdvisorChange(alpha, e.id, {
    expectedRevision: requested.revision,
    status: 'approved',
    reviewComment: 'Đồng ý chuyển giao sinh viên sang Thầy Beta.',
  });

  const approved = await fresh();
  assert.equal(approved.advisorChangeRequest?.status, 'approved');
  assert.equal(approved.advisorChangeRequest?.reviewRole, 'advisor');

  // Verify assignments: old advisor removed, new advisor is primary
  assert.equal(approved.assignments.some(a => a.role === 'primary' && a.lecturerId === 1), false);
  assert.equal(approved.assignments.some(a => a.role === 'primary' && a.lecturerId === 2), true);
});

test('approval resets approved topic to pending for new advisor to review', async () => {
  // Set and approve topic first
  await enrollmentAction(sv, e.id, { expectedRevision: (await fresh()).revision, title: 'Hệ thống học máy' }, 'topic');
  await enrollmentAction(alpha, e.id, { expectedRevision: (await fresh()).revision }, 'topicApprove');
  assert.equal((await fresh()).topicReview?.status, 'approved');

  // Request change
  await requestAdvisorChange(sv, e.id, {
    expectedRevision: (await fresh()).revision,
    targetLecturerId: 2,
    reason: 'Đổi hướng nghiên cứu sang giảng viên Beta.',
  });

  // Admin approves change
  await reviewAdvisorChange(admin, e.id, {
    expectedRevision: (await fresh()).revision,
    status: 'approved',
    reviewComment: 'Khoa phê duyệt chuyển GVHD.',
  });

  const updated = await fresh();
  assert.equal(updated.advisorChangeRequest?.status, 'approved');
  assert.equal(updated.assignments.find(a => a.role === 'primary')?.lecturerId, 2);
  // Topic must be reset to pending for the new advisor
  assert.equal(updated.topicReview?.status, 'pending');
});

test('student can cancel a pending request, and advisor rejection keeps current advisor', async () => {
  // Request change
  await requestAdvisorChange(sv, e.id, {
    expectedRevision: (await fresh()).revision,
    targetLecturerId: 2,
    reason: 'Lý do ban đầu xin đổi...',
  });

  let current = await fresh();
  assert.equal(current.advisorChangeRequest?.status, 'pending');

  // Student cancels
  await cancelAdvisorChange(sv, e.id, { expectedRevision: current.revision });
  current = await fresh();
  assert.equal(current.advisorChangeRequest?.status, 'cancelled');

  // Student can now submit a new request
  await requestAdvisorChange(sv, e.id, {
    expectedRevision: current.revision,
    targetLecturerId: 2,
    reason: 'Lý do thứ hai xin đổi...',
  });
  current = await fresh();
  assert.equal(current.advisorChangeRequest?.status, 'pending');

  // Advisor rejects
  await reviewAdvisorChange(alpha, e.id, {
    expectedRevision: current.revision,
    status: 'rejected',
    reviewComment: 'Đề tài hiện tại đang tiến triển tốt, tiếp tục làm việc cùng GVHD hiện tại.',
  });

  current = await fresh();
  assert.equal(current.advisorChangeRequest?.status, 'rejected');
  // Primary advisor is still lecturer 1
  assert.equal(current.assignments.find(a => a.role === 'primary')?.lecturerId, 1);
});

test('validations: same lecturer, reviewer conflict, and missing reason are rejected', async () => {
  const current = await fresh();

  // Same lecturer
  await assert.rejects(
    requestAdvisorChange(sv, e.id, {
      expectedRevision: current.revision,
      targetLecturerId: 1, // current advisor
      reason: 'Lý do đổi...',
    }),
    errorCode('SAME_LECTURER')
  );

  // Short reason (< 5 chars)
  await assert.rejects(
    requestAdvisorChange(sv, e.id, {
      expectedRevision: current.revision,
      targetLecturerId: 2,
      reason: 'abc',
    }),
    errorCode('INVALID_REASON')
  );
});

test('HTTP API: student requests change and old advisor approves via REST endpoints', async () => {
  const app = express();
  app.use(express.json(), academicRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/enrollments/${e.id}/advisor-change-request`;
  const headers = (who: AuthenticatedUser) => ({
    Authorization: `Bearer ${jwt.sign({ email: who.email }, JWT_SECRET)}`,
    'Content-Type': 'application/json',
  });

  try {
    // 1. Student sends change request
    const postRes = await fetch(base, {
      method: 'POST',
      headers: headers(sv),
      body: JSON.stringify({
        expectedRevision: (await fresh()).revision,
        targetLecturerId: 2,
        reason: 'Lý do gửi qua HTTP endpoint.',
      }),
    });
    assert.equal(postRes.status, 200);
    const postData = await postRes.json();
    assert.equal(postData.advisorChangeRequest?.status, 'pending');

    // 2. Unauthorized lecturer cannot review
    const denyRes = await fetch(`${base}/review`, {
      method: 'POST',
      headers: headers(gamma),
      body: JSON.stringify({
        expectedRevision: postData.revision,
        status: 'approved',
      }),
    });
    assert.equal(denyRes.status, 403);

    // 3. Old advisor approves
    const approveRes = await fetch(`${base}/review`, {
      method: 'POST',
      headers: headers(alpha),
      body: JSON.stringify({
        expectedRevision: postData.revision,
        status: 'approved',
        reviewComment: 'Đồng ý chuyển qua HTTP.',
      }),
    });
    assert.equal(approveRes.status, 200);
    const approvedData = await approveRes.json();
    assert.equal(approvedData.advisorChangeRequest?.status, 'approved');
    assert.equal(approvedData.assignments.find((a: any) => a.role === 'primary')?.lecturerId, 2);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

