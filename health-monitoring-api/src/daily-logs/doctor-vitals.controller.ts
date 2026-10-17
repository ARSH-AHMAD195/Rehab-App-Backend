import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ROLES } from '../common/constants';
import { NotFoundException } from '../common/api.exception';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PatientAccessGuard } from '../common/guards/patient-access.guard';
import { AuthUser, UsersService } from '../users/users.service';
import { DailyLogsService, LogTarget } from './daily-logs.service';
import { DailyLogResponse, LogListResponse } from './log.response';
import { TrendResponse } from './trend.response';
import { LogsQueryDto, TrendsQueryDto } from './dto';

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
