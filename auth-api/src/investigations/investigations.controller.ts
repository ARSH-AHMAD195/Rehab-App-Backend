import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../common/constants';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../users/auth-user';
import {
  AddInvestigationDto,
  InvestigationGridQueryDto,
  RetractInvestigationDto,
  SetInvestigationRangeDto,
} from './investigation.dto';
import { GridRow, InvestigationResponse, InvestigationsService, TestResponse } from './investigations.service';

/** The test list, for building the entry form and the grid. */
@ApiTags('Investigations')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR, ROLES.ADMIN)
@Controller('investigation-tests')
export class InvestigationTestsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get()
  @ApiOperation({
    summary: 'The investigation tests and their fields',
    description: 'Follows the PAC grid. Each number field shows its approved normal range, or null until the clinic sets one.',
  })
  tests(): Promise<{ data: TestResponse[] }> {
    return this.investigations.tests();
  }
}

/** A linked patient's results. Doctors only, like the medical profile. */
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
