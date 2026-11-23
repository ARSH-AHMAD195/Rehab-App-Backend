import { Body, Controller, Get, Headers, Param, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { RATE_LIMITS, ROLES } from '../common/constants';
import { NotFoundException } from '../common/api.exception';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PatientAccessGuard } from '../common/guards/patient-access.guard';
import { AuthUser, UsersService } from '../users/users.service';
import { DailyLogsService, LogTarget } from './daily-logs.service';
import { IdempotencyService } from './idempotency.service';
import { DailyLogResponse, LogListResponse, SaveLogResponse } from './log.response';
import { TrendResponse } from './trend.response';
import { LogsQueryDto, SaveTodayDto, TrendsQueryDto } from './dto';

/**
 * Doctor endpoints, v1.1: the three /doctor/patients/:patientId/vitals routes
 * "take the same query parameters and return the same shapes as the matching
 * /me/vitals routes", plus two rules:
 *
 *  - PatientAccessGuard returns 404 when the patient isn't linked to the
 *    calling doctor;
 *  - every successful call is recorded in the audit log, written after the
 *    access check passes. "If it can't be written, the call fails with 500
 *    rather than returning data unaudited" - which is why the audit write is
 *    awaited before the data is read, and its failure is not caught.
 */
@ApiTags('Doctor vitals')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR)
@UseGuards(PatientAccessGuard)
@ApiParam({ name: 'patientId', description: 'A patient linked to the calling doctor.' })
@ApiNotFoundResponse({ description: 'NOT_FOUND - unknown patient, or not linked to this doctor' })
@Controller('doctor/patients/:patientId/vitals')
export class DoctorVitalsController {
  constructor(
    private readonly logs: DailyLogsService,
    private readonly users: UsersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('today')
  @ApiOperation({ summary: "A patient's log for today" })
  @ApiOkResponse({ type: DailyLogResponse })
  async today(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
  ): Promise<DailyLogResponse> {
    const target = await this.audited(doctor, patientId);
    return this.logs.getToday(target);
  }

  @Put('today')
  @Throttle({
    [RATE_LIMITS.USER.name]: { limit: RATE_LIMITS.WRITE.limit, ttl: RATE_LIMITS.WRITE.ttl },
  })
  @ApiOperation({
    summary: "Enter some or all of a patient's readings for today (issue #25)",
    description:
      'Same body, checks, Idempotency-Key and answer as PUT /me/vitals/today. `date` is the ' +
      "patient's today, in their time zone. The readings count exactly like the patient's own " +
      '(vital alerts, triage); the audit log and each reading record which doctor entered them.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'As on PUT /me/vitals/today.' })
  @ApiOkResponse({ type: SaveLogResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiConflictResponse({ description: "DAY_CHANGED - not the patient's today; IDEMPOTENCY_KEY_IN_USE" })
  @ApiUnprocessableEntityResponse({ description: 'IDEMPOTENCY_KEY_REUSED' })
  async save(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Body() body: SaveTodayDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SaveLogResponse> {
    const patient = await this.users.getPatient(patientId);
    if (!patient) throw new NotFoundException('Patient not found');
    const target = { id: patient.id, timeZone: patient.timeZone };
    return this.idempotency.run(patient.id, idempotencyKey, body, () => this.logs.save(target, body, doctor));
  }

  @Get('logs')
  @ApiOperation({ summary: "A patient's past logs" })
  @ApiOkResponse({ type: LogListResponse })
  async list(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Query() query: LogsQueryDto,
  ): Promise<LogListResponse> {
    const target = await this.audited(doctor, patientId);
    return this.logs.listLogs(target, query);
  }

  @Get('trends')
  @ApiOperation({ summary: "A patient's trends" })
  @ApiOkResponse({ type: TrendResponse })
  async trends(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Query() query: TrendsQueryDto,
  ): Promise<TrendResponse> {
    const target = await this.audited(doctor, patientId);
    return this.logs.trends(target, query);
  }

  /**
   * Resolves the patient (for their time zone - the days shown are the
   * patient's, not the doctor's) and records the view before any reading is
   * read.
   */
  private async audited(doctor: AuthUser, patientId: string): Promise<LogTarget> {
    const patient = await this.users.getPatient(patientId);
    if (!patient) throw new NotFoundException('Patient not found');

    await this.logs.recordDoctorView(doctor, patientId);
    return { id: patient.id, timeZone: patient.timeZone };
  }
}
