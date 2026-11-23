import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../common/constants';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../users/auth-user';
import {
  AddInvestigationDto,
  InvestigationGridQueryDto,
  MyInvestigationsQueryDto,
  RetractInvestigationDto,
  SetInvestigationRangeDto,
} from './investigation.dto';
import { GridRow, InvestigationResponse, InvestigationsService, TestResponse } from './investigations.service';

/** The test list, for building the entry form and the grid. Patients read it too, for the units. */
@ApiTags('Investigations')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR, ROLES.ADMIN, ROLES.PATIENT)
@Controller('investigation-tests')
export class InvestigationTestsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get()
  @ApiOperation({
    summary: 'The investigation tests and their fields',
    description:
      'Follows the PAC grid: labels, units and each number field\'s approved normal range (null until the clinic sets one). Any signed-in user.',
  })
  tests(): Promise<{ data: TestResponse[] }> {
    return this.investigations.tests();
  }
}

/** The signed-in patient's own results, read only (issue #19). */
@ApiTags('Investigations')
@ApiBearerAuth()
@Roles(ROLES.PATIENT)
@Controller('patients/me/investigations')
export class MyInvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My test results (patient)',
    description:
      'Same shape as the doctor\'s grid: every test with its results, newest first. Results entered in error are left out. Units are in GET /investigation-tests.',
  })
  mine(@CurrentUser() patient: AuthUser, @Query() query: MyInvestigationsQueryDto): Promise<{ patientId: string; tests: GridRow[] }> {
    return this.investigations.mine(patient, query.test);
  }
}

/** A patient's results, for doctors, like the medical profile. */
@ApiTags('Investigations')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR)
@Controller('patients/:patientId/investigations')
export class PatientInvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Add a result',
    description: 'One test on one date. Repeat tests are new results, so the history is kept. Send wnl: true instead of values for LFT, TFT, ECG and imaging.',
  })
  add(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Body() body: AddInvestigationDto,
  ): Promise<InvestigationResponse> {
    return this.investigations.add(doctor, patientId, body);
  }

  @Get()
  @ApiOperation({
    summary: "The patient's investigations grid",
    description: 'Every test with its results, newest first. Values outside an approved normal range are flagged. Each read is audited.',
  })
  grid(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Query() query: InvestigationGridQueryDto,
  ): Promise<{ patientId: string; tests: GridRow[] }> {
    return this.investigations.grid(doctor, patientId, query);
  }

  @Post(':resultId/retract')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a result as entered in error',
    description: 'The result is kept (with the reason) but leaves the grid. Enter the right value as a new result.',
  })
  retract(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Param('resultId') resultId: string,
    @Body() body: RetractInvestigationDto,
  ): Promise<InvestigationResponse> {
    return this.investigations.retract(doctor, patientId, resultId, body.reason);
  }
}

/** Approved normal ranges, from the clinical team. */
@ApiTags('Investigations')
@ApiBearerAuth()
@Roles(ROLES.ADMIN)
@Controller('admin/investigation-ranges')
export class InvestigationRangesController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get()
  @ApiOperation({ summary: 'Approved normal ranges', description: 'Empty until the clinical team supplies them.' })
  list(): ReturnType<InvestigationsService['listRanges']> {
    return this.investigations.listRanges();
  }

  @Put()
  @ApiOperation({
    summary: 'Set the approved normal range of one field',
    description: 'Only values the clinical team has approved. low and high both null removes the range. Audited.',
  })
  set(@CurrentUser() admin: AuthUser, @Body() body: SetInvestigationRangeDto): ReturnType<InvestigationsService['setRange']> {
    return this.investigations.setRange(admin, body);
  }
}
