import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../users/auth-user';
import { UsersService } from '../users/users.service';
import { UpdateMedicalProfileDto } from './medical-profile.dto';
import { MedicalProfileResponse, MedicalProfilesService } from './medical-profiles.service';

/**
 * The patient's own medical profile.
 *
 * Registered BEFORE PatientMedicalProfileController (see the module): both
 * match /patients/<x>/medical-profile, and "me" must not be read as a
 * patient id.
 */
@ApiTags('Medical profile')
@ApiBearerAuth()
@Roles(ROLES.PATIENT)
@Controller('patients/me/medical-profile')
export class MyMedicalProfileController {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: MedicalProfilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My medical profile', description: 'Every field null and version 0 until first saved.' })
  async get(@CurrentUser() patient: AuthUser): Promise<MedicalProfileResponse> {
    return this.profiles.get((await this.users.model.findById(patient.id).exec())!);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update my medical profile',
    description: 'Send only changed fields plus the version you read. 409 CONCURRENT_UPDATE if someone saved first.',
  })
  async update(@CurrentUser() patient: AuthUser, @Body() body: UpdateMedicalProfileDto): Promise<MedicalProfileResponse> {
    return this.profiles.update(patient, (await this.users.model.findById(patient.id).exec())!, body);
  }
}

/** A linked patient's medical profile, for doctors. Admins have no access. */
@ApiTags('Medical profile')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR)
@Controller('patients/:patientId/medical-profile')
export class PatientMedicalProfileController {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: MedicalProfilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: "A linked patient's medical profile", description: 'Each read is audited.' })
  async get(@CurrentUser() doctor: AuthUser, @Param('patientId') patientId: string): Promise<MedicalProfileResponse> {
    const patient = await this.users.getPatientFor(doctor, patientId);
    return this.profiles.getAsDoctor(doctor, patient);
  }

  @Patch()
  @ApiOperation({ summary: "Update a linked patient's medical profile" })
  async update(
    @CurrentUser() doctor: AuthUser,
    @Param('patientId') patientId: string,
    @Body() body: UpdateMedicalProfileDto,
  ): Promise<MedicalProfileResponse> {
    const patient = await this.users.getPatientFor(doctor, patientId);
    return this.profiles.update(doctor, patient, body);
  }
}
