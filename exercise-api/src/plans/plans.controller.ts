import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PatientAccessGuard } from '../common/guards/patient-access.guard';
import { AuthUser } from '../users/users.service';
import { PlansService } from './plans.service';
import { PlanResponse, PlanVersionListResponse, PlanVersionsQueryDto, SavePlanDto } from './plan.dto';

@ApiTags('Exercise plans')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE' })
@Controller('patients')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  // Declared before the :patientId routes, so "me" is never read as an id.
  @Get('me/exercise-plan')
  @Roles(ROLES.PATIENT)
  @ApiOperation({ summary: 'My current plan, with exercise details and videos (patient)' })
  @ApiOkResponse({ type: PlanResponse })
  mine(@CurrentUser() patient: AuthUser): Promise<PlanResponse> {
    return this.plans.forPatient(patient);
  }

  @Get(':patientId/exercise-plan')
  @Roles(ROLES.DOCTOR)
  @UseGuards(PatientAccessGuard)
  @ApiOperation({ summary: "A linked patient's current plan (doctor)" })
  @ApiOkResponse({ type: PlanResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - no such patient, or not linked to you' })
  forPatient(@CurrentUser() doctor: AuthUser, @Param('patientId') patientId: string): Promise<PlanResponse> {
    return this.plans.forDoctor(patientId, doctor);
  }

  @Put(':patientId/exercise-plan')
  @Roles(ROLES.DOCTOR)
  @UseGuards(PatientAccessGuard)
  @ApiOperation({
    summary: "Assign or replace a linked patient's plan (doctor)",
    description:
      'Send the version you last saw (0 for a first plan). Each change saves a new version and keeps the old ones. ' +
      'An empty items list clears the plan.',
  })
  @ApiOkResponse({ type: PlanResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED - e.g. UNKNOWN_ID or NOT_ALLOWED for an exercise' })
  @ApiConflictResponse({ description: 'CONCURRENT_UPDATE - the plan changed since you loaded it' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - no such patient, or not linked to you' })
  save(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Body() body: SavePlanDto,
  ): Promise<PlanResponse> {
    return this.plans.save(patientId, body, doctor);
  }

  @Get(':patientId/exercise-plan/versions')
  @Roles(ROLES.DOCTOR)
  @UseGuards(PatientAccessGuard)
  @ApiOperation({ summary: "Every version of a linked patient's plan, newest first (doctor)" })
  @ApiOkResponse({ type: PlanVersionListResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - no such patient, or not linked to you' })
  versions(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Query() query: PlanVersionsQueryDto,
  ): Promise<PlanVersionListResponse> {
    return this.plans.versions(patientId, query, doctor);
  }
}
