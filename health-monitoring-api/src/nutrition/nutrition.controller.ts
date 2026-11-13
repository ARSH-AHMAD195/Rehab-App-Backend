import { Body, Controller, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RATE_LIMITS, ROLES } from '../common/constants';
import { NotFoundException } from '../common/api.exception';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PatientAccessGuard } from '../common/guards/patient-access.guard';
import { AuthUser, UsersService } from '../users/users.service';
import { MealsQueryDto, SaveMealDto, UpdateDietPlanDto } from './nutrition.dto';
import { DietPlanResponse, MealDayResponse, MealHistoryDay, NutritionService } from './nutrition.service';

/** The patient's diet chart and meal ticking. The patient always comes from the token. */
@ApiTags('Nutrition (patient)')
@ApiBearerAuth()
@Roles(ROLES.PATIENT)
@Controller('me')
export class MeNutritionController {
  constructor(private readonly nutrition: NutritionService) {}

  @Get('diet-plan')
  @ApiOperation({ summary: 'My diet chart', description: "The hospital chart, or my doctor's version of it. Labels come in English and (once supplied) Hindi." })
  plan(@CurrentUser() patient: AuthUser): Promise<DietPlanResponse> {
    return this.nutrition.plan(patient);
  }

  @Get('meals/today')
  @ApiOperation({ summary: "Today's meals", description: 'Each slot with its options (ticked or not), the day so far and the percent of each target, for the progress bar.' })
  today(@CurrentUser() patient: AuthUser): Promise<MealDayResponse> {
    return this.nutrition.today(patient);
  }

  @Put('meals/today/:slot')
  @Throttle({ [RATE_LIMITS.USER.name]: { limit: RATE_LIMITS.WRITE.limit, ttl: RATE_LIMITS.WRITE.ttl } })
  @ApiOperation({
    summary: 'What I ate in one meal slot',
    description:
      'Send the options eaten; [] clears the slot. A slot counts its full calories and protein once anything in it is ticked. ' +
      'Sending the same again changes nothing. 409 DAY_CHANGED if the date is no longer today.',
  })
  save(@CurrentUser() patient: AuthUser, @Param('slot') slot: string, @Body() body: SaveMealDto): Promise<MealDayResponse> {
    return this.nutrition.saveMeal(patient, slot, body);
  }

  @Get('meals')
  @ApiOperation({ summary: 'Past days', description: 'One row per day, newest first: totals against that day’s targets. Default: the last 7 days; at most 90.' })
  history(@CurrentUser() patient: AuthUser, @Query() query: MealsQueryDto): Promise<{ data: MealHistoryDay[] }> {
    return this.nutrition.history(patient, query);
  }
}

/** A linked patient's nutrition, for doctors. Every call is audited. */
@ApiTags('Nutrition (doctor)')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR)
@UseGuards(PatientAccessGuard)
@ApiParam({ name: 'patientId', description: 'A patient linked to the calling doctor.' })
@ApiNotFoundResponse({ description: 'NOT_FOUND - unknown patient, or not linked to this doctor' })
@Controller('doctor/patients/:patientId')
export class DoctorNutritionController {
  constructor(
    private readonly nutrition: NutritionService,
    private readonly users: UsersService,
  ) {}

  @Get('diet-plan')
  @ApiOperation({ summary: "The patient's diet plan", description: 'version 0 = still the hospital chart.' })
  async plan(@CurrentUser() doctor: AuthUser, @Param('patientId') patientId: string): Promise<DietPlanResponse> {
    return this.nutrition.planAsDoctor(doctor, await this.patient(patientId));
  }

  @Patch('diet-plan')
  @ApiOperation({
    summary: "Change the patient's targets, diet type or food options",
    description: 'Send only what changes, plus the version read (0 for the hospital chart). `slots` replaces the whole list. Past days keep the values they were logged with. Audited.',
  })
  async update(@CurrentUser() doctor: AuthUser, @Param('patientId') patientId: string, @Body() body: UpdateDietPlanDto): Promise<DietPlanResponse> {
    return this.nutrition.updatePlan(doctor, await this.patient(patientId), body);
  }

  @Get('meals/today')
  @ApiOperation({ summary: "The patient's meals today" })
  async today(@CurrentUser() doctor: AuthUser, @Param('patientId') patientId: string): Promise<MealDayResponse> {
    return this.nutrition.todayAsDoctor(doctor, await this.patient(patientId));
  }

  @Get('meals')
  @ApiOperation({ summary: "The patient's past days" })
  async history(@CurrentUser() doctor: AuthUser, @Param('patientId') patientId: string, @Query() query: MealsQueryDto): Promise<{ data: MealHistoryDay[] }> {
    return this.nutrition.historyAsDoctor(doctor, await this.patient(patientId), query);
  }

  private async patient(patientId: string): Promise<AuthUser> {
    const patient = await this.users.getPatient(patientId);
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }
}
