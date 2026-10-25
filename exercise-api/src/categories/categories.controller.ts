import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../users/users.service';
import { CategoriesService } from './categories.service';
import {
  CategoryListResponse,
  CategoryResponse,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './category.dto';

@ApiTags('Exercise categories')
@ApiBearerAuth()
@Controller('exercise-categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List active categories (any role)' })
  @ApiOkResponse({ type: CategoryListResponse })
  async list(
    @CurrentUser() caller: AuthUser,
    @Query() query: ListCategoriesQueryDto,
  ): Promise<CategoryListResponse> {
    return { data: await this.categories.list(caller, query.includeInactive) };
  }

  @Post()
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Add a category (admin)' })
  @ApiCreatedResponse({ type: CategoryResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED - e.g. ALREADY_EXISTS for a taken code' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE' })
  create(@CurrentUser() admin: AuthUser, @Body() body: CreateCategoryDto): Promise<CategoryResponse> {
    return this.categories.create(body, admin);
  }

  @Patch(':categoryId')
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Rename, reorder, deactivate or reactivate a category (admin)' })
  @ApiOkResponse({ type: CategoryResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED - NOT_ALLOWED when deactivating a category in use' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND' })
  update(
    @CurrentUser() admin: AuthUser,
    @Param('categoryId') id: string,
    @Body() body: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categories.update(id, body, admin);
  }

  @Delete(':categoryId')
  @Roles(ROLES.ADMIN)
  @ApiOperation({
    summary: 'Deactivate a category (admin)',
    description: 'Categories are never removed. Refused while active exercises use it.',
  })
  @ApiOkResponse({ type: CategoryResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND' })
  deactivate(@CurrentUser() admin: AuthUser, @Param('categoryId') id: string): Promise<CategoryResponse> {
    return this.categories.deactivate(id, admin);
  }
}
