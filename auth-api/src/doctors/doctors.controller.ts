import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RATE_LIMITS, ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../users/auth-user';
import { RegisterDoctorDto, UpdateDoctorDto, UserListQueryDto } from '../users/user.dto';
import { DoctorResponse } from '../users/user.responses';
import { DoctorsService } from './doctors.service';

@ApiTags('Doctors (admin)')
@ApiBearerAuth()
@Roles(ROLES.ADMIN)
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Post()
  @Throttle({ [RATE_LIMITS.USER.name]: RATE_LIMITS.REGISTER })
  @ApiOperation({ summary: 'Register a doctor', description: 'Firebase emails them a link to set their password.' })
  register(@CurrentUser() admin: AuthUser, @Body() body: RegisterDoctorDto): Promise<DoctorResponse & { invitation: string }> {
    return this.doctors.register(admin, body);
  }

  @Get()
  @ApiOperation({ summary: 'List doctors', description: 'Sorted by name. Defaults to active doctors.' })
  list(@Query() query: UserListQueryDto): Promise<{ data: DoctorResponse[]; nextCursor: string | null }> {
    return this.doctors.list(query);
  }

  @Get(':doctorId')
  @ApiOperation({ summary: 'One doctor' })
  get(@Param('doctorId') doctorId: string): Promise<DoctorResponse> {
    return this.doctors.get(doctorId);
  }

  @Patch(':doctorId')
  @ApiOperation({
    summary: 'Update, deactivate or reactivate a doctor',
    description: '409 DOCTOR_HAS_PATIENTS when deactivating would leave an active patient with no doctor.',
  })
  update(
    @CurrentUser() admin: AuthUser,
    @Param('doctorId') doctorId: string,
    @Body() body: UpdateDoctorDto,
  ): Promise<DoctorResponse> {
    return this.doctors.update(admin, doctorId, body);
  }
}
