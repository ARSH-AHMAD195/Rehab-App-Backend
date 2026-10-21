import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PatientAccessGuard } from '../common/guards/patient-access.guard';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { AuthUser } from '../users/users.service';
import { CompletionsService } from './completions.service';
import { ComplianceService } from './compliance.service';
import { ComplianceQueryDto, ComplianceResponse } from './compliance.dto';
import {
  ChecklistQueryDto,
  ChecklistResponse,
  CompletionListResponse,
  CompletionResponse,
  HistoryQueryDto,
  RecordCompletionDto,
} from './completion.dto';

/** Ticking exercises off, and undoing a tick. Patients only. */
@ApiTags('Exercise completions')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE' })
@Roles(ROLES.PATIENT)
@Controller('exercise-completions')
export class CompletionsController {
  constructor(
    private readonly completions: CompletionsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Record "I did this one" (patient)',
    description:
      'For an item in your current plan, planned for today, not yet done timesPerDay times. For retries after a ' +
      'timeout, send an Idempotency-Key: a retry with the same key gets the first answer back and counts nothing.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Optional. A unique id per tick (e.g. a UUID), the same on every retry of it. 1-255 visible ASCII characters.',
  })
  @ApiCreatedResponse({ type: CompletionResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiConflictResponse({
    description: 'EXERCISE_NOT_IN_PLAN, DAY_CHANGED, EXERCISE_ALREADY_DONE, or IDEMPOTENCY_KEY_IN_USE (retry shortly)',
  })
  @ApiUnprocessableEntityResponse({ description: 'IDEMPOTENCY_KEY_REUSED - the key was used with a different body' })
  record(
    @CurrentUser() patient: AuthUser,
    @Body() body: RecordCompletionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CompletionResponse> {
    return this.idempotency.run(patient.id, idempotencyKey, body, () => this.completions.record(patient, body));
  }

  @Delete(':completionId')
  @HttpCode(204)
  @ApiOperation({ summary: "Undo one of today's ticks (patient)", description: '⏳ Same day only, until the client decides.' })
  @ApiNoContentResponse({ description: 'Undone' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - no such tick of yours, or already undone' })
  @ApiConflictResponse({ description: 'DAY_CHANGED - the tick is from an earlier day' })
  undo(@CurrentUser() patient: AuthUser, @Param('completionId') id: string): Promise<void> {
    return this.completions.undo(patient, id);
  }
}

/** Today's checklist and the history of ticks, for the patient and their doctors. */
@ApiTags('Exercise completions')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE' })
@Controller('patients')
export class PatientCompletionsController {
  constructor(
    private readonly completions: CompletionsService,
    private readonly compliance: ComplianceService,
  ) {}

  // The "me" routes come first, so "me" is never read as a patient id.
  @Get('me/exercise-checklist')
  @Roles(ROLES.PATIENT)
  @ApiOperation({ summary: "Today's planned exercises and how many times each is done (patient)" })
  @ApiOkResponse({ type: ChecklistResponse })
  myChecklist(@CurrentUser() patient: AuthUser): Promise<ChecklistResponse> {
    return this.completions.myChecklist(patient);
  }

  @Get('me/exercise-completions')
  @Roles(ROLES.PATIENT)
  @ApiOperation({ summary: 'My ticks, newest first (patient)', description: 'from/to default to the last 30 days.' })
  @ApiOkResponse({ type: CompletionListResponse })
  myHistory(@CurrentUser() patient: AuthUser, @Query() query: HistoryQueryDto): Promise<CompletionListResponse> {
    return this.completions.myHistory(patient, query);
  }

  @Get(':patientId/exercise-checklist')
  @Roles(ROLES.DOCTOR)
  @UseGuards(PatientAccessGuard)
  @ApiOperation({ summary: "A linked patient's checklist for one day, today by default (doctor)" })
  @ApiOkResponse({ type: ChecklistResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - no such patient, or not linked to you' })
  checklist(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Query() query: ChecklistQueryDto,
  ): Promise<ChecklistResponse> {
    return this.completions.checklistForDoctor(patientId, query.date, doctor);
  }

  @Get(':patientId/exercise-compliance')
  @Roles(ROLES.DOCTOR)
  @UseGuards(PatientAccessGuard)
  @ApiOperation({
    summary: 'How well a linked patient kept to the plan, as counts (doctor)',
    description:
      'Planned and done, per day and per exercise. Each day is counted against the plan in place that day. ' +
      'percentage is null until the client agrees the formula. Last 7 days by default, at most 90.',
  })
  @ApiOkResponse({ type: ComplianceResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED - e.g. `to` after today, or more than 90 days' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - no such patient, or not linked to you' })
  complianceForPatient(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Query() query: ComplianceQueryDto,
  ): Promise<ComplianceResponse> {
    return this.compliance.forDoctor(patientId, query, doctor);
  }

  @Get(':patientId/exercise-completions')
  @Roles(ROLES.DOCTOR)
  @UseGuards(PatientAccessGuard)
  @ApiOperation({ summary: "A linked patient's ticks, newest first (doctor)" })
  @ApiOkResponse({ type: CompletionListResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - no such patient, or not linked to you' })
  history(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Query() query: HistoryQueryDto,
  ): Promise<CompletionListResponse> {
    return this.completions.historyForDoctor(patientId, query, doctor);
  }
}
