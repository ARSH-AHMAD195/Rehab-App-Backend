import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsObject } from 'class-validator';
import { ROLES } from '../common/constants';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { toLocalIso } from '../common/time';
import { AuthUser } from '../users/auth-user';
import { UsersService } from '../users/users.service';
import { DEFAULT_TRIAGE_RULES, TriageRuleSet } from './triage-rules';
import { TriageResult, TriageService } from './triage.service';

export class SetTriageRulesDto {
  @ApiProperty({ example: DEFAULT_TRIAGE_RULES, description: 'Every setting, in the same shape as GET returns' })
  @IsObject()
  rules!: Record<string, unknown>;

  @ApiProperty({ description: 'true once the clinical team has signed these rules off; tags then stop being provisional' })
  @IsBoolean()
  confirmed!: boolean;
}

@ApiTags('Triage')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR)
@Controller('patients/:patientId/triage')
export class PatientTriageController {
  constructor(
    private readonly users: UsersService,
    private readonly triage: TriageService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "A linked patient's triage tag, with the reasons",
    description:
      'HIGH / MEDIUM / LOW from the latest profile, investigations and vitals, worked out now. ' +
      '`missing` lists what could not count; `provisional` is true until the clinical team confirms the rules. Audited.',
  })
  async get(@CurrentUser() doctor: AuthUser, @Param('patientId') patientId: string): Promise<TriageResult & { patientId: string }> {
    const patient = await this.users.getPatientFor(doctor, patientId);
    return this.triage.forPatientAsDoctor(doctor, patient);
  }
}

@ApiTags('Triage')
@ApiBearerAuth()
@Roles(ROLES.ADMIN)
@Controller('admin/triage-rules')
export class TriageRulesController {
  constructor(private readonly triage: TriageService) {}

  @Get()
  @ApiOperation({ summary: 'The triage rules in force', description: "Version 1 is the client's table, not yet confirmed." })
  async get(): Promise<{ version: number; rules: TriageRuleSet; confirmed: boolean; updatedAt: string | null }> {
    const current = await this.triage.currentRules();
    return { ...current, updatedAt: toLocalIso(current.updatedAt) };
  }

  @Put()
  @ApiOperation({
    summary: 'Save a new version of the triage rules',
    description: 'Only numbers the clinical team approved. Earlier versions are kept; the change is audited.',
  })
  set(@CurrentUser() admin: AuthUser, @Body() body: SetTriageRulesDto): ReturnType<TriageService['setRules']> {
    return this.triage.setRules(admin, body.rules, body.confirmed);
  }
}
