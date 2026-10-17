import { Body, Controller, Get, Headers, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { RATE_LIMITS, ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../users/users.service';
import { DailyLogsService } from './daily-logs.service';
import { IdempotencyService } from './idempotency.service';
import { DailyLogResponse, LogListResponse, SaveLogResponse } from './log.response';
import { TrendResponse } from './trend.response';
import { LogsQueryDto, SaveTodayDto, TrendsQueryDto } from './dto';

/**
 * The four patient routes of v1.1. The patient id always comes from the
 * verified token, never from the request (Save flow step 2), so there is no
 * patient id in any of these paths.
 */
@ApiTags('Patient vitals')
@ApiBearerAuth()
@Roles(ROLES.PATIENT)
@Controller('me/vitals')
export class MeVitalsController {
  constructor(
    private readonly logs: DailyLogsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('today')
  @ApiOperation({ summary: "Today's log with status, to pre-fill the form and Health tab" })
  @ApiOkResponse({ type: DailyLogResponse })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE' })
  async today(@CurrentUser() patient: AuthUser): Promise<DailyLogResponse> {
    return this.logs.getToday(patient);
  }

  @Put('today')
  // Narrows the per-user limit on this route to 30/min, instead of 120/min.
  // The per-IP limit of 300/min still applies on top.
  @Throttle({
    [RATE_LIMITS.USER.name]: { limit: RATE_LIMITS.WRITE.limit, ttl: RATE_LIMITS.WRITE.ttl },
  })
  @ApiOperation({
    summary: 'Save or update some or all of today’s readings',
    description:
      'Send only the fields that changed; fields you don’t send stay as they are, and null ' +
      'clears a value. Re-sending the same body changes nothing. For retries after a timeout, ' +
      'send an Idempotency-Key: a retry with the same key gets the first answer back and ' +
      'saves nothing, even if the log changed in between.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional. A unique id per save attempt (e.g. a UUID), the same on every retry of it. ' +
      'Remembered for 24 hours, per patient. 1-255 visible ASCII characters.',
  })
  @ApiOkResponse({ type: SaveLogResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiConflictResponse({
    description:
      'DAY_CHANGED - the date sent is no longer the patient’s today; ' +
      'IDEMPOTENCY_KEY_IN_USE - a request with this key is still running, retry shortly',
  })
  @ApiUnprocessableEntityResponse({
    description: 'IDEMPOTENCY_KEY_REUSED - this key was already used with a different body',
  })
  @ApiTooManyRequestsResponse({ description: 'RATE_LIMITED' })
  async save(
    @CurrentUser() patient: AuthUser,
    @Body() body: SaveTodayDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SaveLogResponse> {
    return this.idempotency.run(patient.id, idempotencyKey, body, () => this.logs.save(patient, body));
  }

  @Get('logs')
  @ApiOperation({ summary: 'Past daily logs, newest first' })
  @ApiOkResponse({ type: LogListResponse })
  async list(
    @CurrentUser() patient: AuthUser,
    @Query() query: LogsQueryDto,
  ): Promise<LogListResponse> {
    return this.logs.listLogs(patient, query);
  }

  @Get('trends')
  @ApiOperation({ summary: 'Daily trend series for one parameter' })
  @ApiOkResponse({ type: TrendResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED - unknown type, or NUTRITION' })
  async trends(
    @CurrentUser() patient: AuthUser,
    @Query() query: TrendsQueryDto,
  ): Promise<TrendResponse> {
    return this.logs.trends(patient, query);
  }
}
