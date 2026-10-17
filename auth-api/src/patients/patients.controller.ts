import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RATE_LIMITS, ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../users/auth-user';
import { PatientListQueryDto, RegisterPatientDto, SetDoctorsDto, UpdatePatientDto } from '../users/user.dto';
import { PatientResponse } from '../users/user.responses';
import { PatientsService } from './patients.service';

/**
 * Patient management. A doctor reaches only linked patients; any other id is
 * 404 to them, so they can't tell whether that patient exists.
 */
@ApiTags('Patients (doctor, admin)')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR, ROLES.ADMIN)
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Post()
  @Throttle({ [RATE_LIMITS.USER.name]: RATE_LIMITS.REGISTER })
  @ApiOperation({
    summary: 'Register a patient',
    description: 'Doctor: the patient is linked to you. Admin: doctorIds is required.',
  })
  register(@CurrentUser() caller: AuthUser, @Body() body: RegisterPatientDto): Promise<PatientResponse & { invitation: string }> {
    return this.patients.register(caller, body);
  }

  @Get()
  @ApiOperation({ summary: 'Patient list', description: 'Doctor: linked patients only. Admin: all.' })
  list(
    @CurrentUser() caller: AuthUser,
    @Query() query: PatientListQueryDto,
  ): Promise<{ data: PatientResponse[]; nextCursor: string | null }> {
    return this.patients.list(caller, query);
  }

  @Get(':patientId')
  @ApiOperation({ summary: 'One patient' })
  get(@CurrentUser() caller: AuthUser, @Param('patientId') patientId: string): Promise<PatientResponse> {
    return this.patients.get(caller, patientId);
  }

  @Patch(':patientId')
  @ApiOperation({ summary: "Update a patient's basic details", description: 'Only an admin may send `active`.' })
  update(
    @CurrentUser() caller: AuthUser,
    @Param('patientId') patientId: string,
    @Body() body: UpdatePatientDto,
  ): Promise<PatientResponse> {
    return this.patients.update(caller, patientId, body);
  }

  @Put(':patientId/doctors')
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Set which doctors a patient is linked to', description: 'Replaces the list: 1-10 active doctors.' })
  setDoctors(
    @CurrentUser() admin: AuthUser,
    @Param('patientId') patientId: string,
    @Body() body: SetDoctorsDto,
  ): Promise<PatientResponse> {
    return this.patients.setDoctors(admin, patientId, body.doctorIds);
  }
}
