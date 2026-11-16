import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PatientListDoc, PatientResponseDoc, RegisteredPatientDoc } from '../common/response-docs';
import { RATE_LIMITS, ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../users/auth-user';
import { PatientListQueryDto, RegisterPatientDto, SetDoctorsDto, UpdatePatientDto } from '../users/user.dto';
import { PatientResponse } from '../users/user.responses';
import { PatientsService } from './patients.service';

/**
 * Patient management. Every doctor reaches every patient (team decision,
 * Nov 2026). The doctor-patient link only marks "my patients".
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
  @ApiCreatedResponse({ type: RegisteredPatientDoc })
  register(@CurrentUser() caller: AuthUser, @Body() body: RegisterPatientDto): Promise<PatientResponse & { invitation: string }> {
    return this.patients.register(caller, body);
  }

  @Get()
  @ApiOperation({ summary: 'Patient list', description: 'Every patient. Doctor: scope=mine for only the patients linked to you. Admin: doctorId to filter.' })
  @ApiOkResponse({ type: PatientListDoc })
  list(
    @CurrentUser() caller: AuthUser,
    @Query() query: PatientListQueryDto,
  ): Promise<{ data: PatientResponse[]; nextCursor: string | null }> {
    return this.patients.list(caller, query);
  }

  @Get(':patientId')
  @ApiOperation({ summary: 'One patient' })
  @ApiOkResponse({ type: PatientResponseDoc })
  get(@CurrentUser() caller: AuthUser, @Param('patientId') patientId: string): Promise<PatientResponse> {
    return this.patients.get(caller, patientId);
  }

  @Patch(':patientId')
  @ApiOperation({ summary: "Update a patient's basic details", description: 'Only an admin may send `active`.' })
  @ApiOkResponse({ type: PatientResponseDoc })
  update(
    @CurrentUser() caller: AuthUser,
    @Param('patientId') patientId: string,
    @Body() body: UpdatePatientDto,
  ): Promise<PatientResponse> {
    return this.patients.update(caller, patientId, body);
  }

  @Put(':patientId/doctors/me')
  @Roles(ROLES.DOCTOR)
  @ApiOperation({
    summary: 'Add this patient to my patients',
    description: "Links you to the patient: their alerts and login-code requests reach your inbox. Doing it again changes nothing. Audited.",
  })
  @ApiOkResponse({ type: PatientResponseDoc })
  linkMe(@CurrentUser() doctor: AuthUser, @Param('patientId') patientId: string): Promise<PatientResponse> {
    return this.patients.linkMe(doctor, patientId);
  }

  @Delete(':patientId/doctors/me')
  @Roles(ROLES.DOCTOR)
  @ApiOperation({
    summary: 'Take this patient off my patients',
    description: 'You can still open their chart. 409 LAST_DOCTOR if no other doctor is linked. Doing it again changes nothing. Audited.',
  })
  @ApiOkResponse({ type: PatientResponseDoc })
  @ApiConflictResponse({ description: 'LAST_DOCTOR - you are the only doctor linked to this patient' })
  unlinkMe(@CurrentUser() doctor: AuthUser, @Param('patientId') patientId: string): Promise<PatientResponse> {
    return this.patients.unlinkMe(doctor, patientId);
  }

  @Put(':patientId/doctors')
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Set which doctors a patient is linked to', description: 'Replaces the list: 1-10 active doctors.' })
  @ApiOkResponse({ type: PatientResponseDoc })
  setDoctors(
    @CurrentUser() admin: AuthUser,
    @Param('patientId') patientId: string,
    @Body() body: SetDoctorsDto,
  ): Promise<PatientResponse> {
    return this.patients.setDoctors(admin, patientId, body.doctorIds);
  }
}
