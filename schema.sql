--
-- PostgreSQL database dump
--

\restrict pKqN2Mr5DQlro3tsjZMssfIqdhfiLbYBHII8uuS2UWsKP1jVqzeJwOwzzICcIuu

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: assignment_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.assignment_status AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED'
);


ALTER TYPE public.assignment_status OWNER TO postgres;

--
-- Name: brd_format_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.brd_format_enum AS ENUM (
    'NEW',
    'OLD'
);


ALTER TYPE public.brd_format_enum OWNER TO postgres;

--
-- Name: brd_status_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.brd_status_enum AS ENUM (
    'DRAFT',
    'PAUSED',
    'COMPLETED',
    'APPROVED',
    'ON_HOLD'
);


ALTER TYPE public.brd_status_enum OWNER TO postgres;

--
-- Name: role_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.role_enum AS ENUM (
    'SUPER_ADMIN',
    'ADMIN',
    'USER'
);


ALTER TYPE public.role_enum OWNER TO postgres;

--
-- Name: status_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.status_enum AS ENUM (
    'ACTIVE',
    'INACTIVE'
);


ALTER TYPE public.status_enum OWNER TO postgres;

--
-- Name: task_status_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.task_status_enum AS ENUM (
    'PENDING',
    'PROCESSING',
    'PROCESSED',
    'SUBMITTED',
    'APPROVED',
    'REJECTED'
);


ALTER TYPE public.task_status_enum OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._prisma_migrations (
    id text NOT NULL,
    checksum text,
    finished_at timestamp without time zone,
    migration_name text,
    logs text,
    rolled_back_at timestamp without time zone,
    started_at timestamp without time zone,
    applied_steps_count integer
);


ALTER TABLE public._prisma_migrations OWNER TO postgres;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_settings (
    id integer NOT NULL,
    key text,
    value text,
    createdat timestamp without time zone,
    updatedat timestamp without time zone
);


ALTER TABLE public.app_settings OWNER TO postgres;

--
-- Name: app_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.app_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.app_settings_id_seq OWNER TO postgres;

--
-- Name: app_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.app_settings_id_seq OWNED BY public.app_settings.id;


--
-- Name: brd_cell_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.brd_cell_images (
    id integer NOT NULL,
    brd_id text NOT NULL,
    table_index integer NOT NULL,
    row_index integer NOT NULL,
    col_index integer NOT NULL,
    rid text NOT NULL,
    media_name text NOT NULL,
    mime_type text NOT NULL,
    cell_text text DEFAULT ''::text NOT NULL,
    section text DEFAULT 'unknown'::text NOT NULL,
    field_label text DEFAULT ''::text NOT NULL,
    image_data bytea,
    extracted_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.brd_cell_images OWNER TO postgres;

--
-- Name: brd_cell_images_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.brd_cell_images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.brd_cell_images_id_seq OWNER TO postgres;

--
-- Name: brd_cell_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.brd_cell_images_id_seq OWNED BY public.brd_cell_images.id;


--
-- Name: brd_sections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.brd_sections (
    id integer NOT NULL,
    brd_id text NOT NULL,
    scope jsonb,
    metadata jsonb,
    toc jsonb,
    citations jsonb,
    content_profile jsonb,
    brd_config jsonb,
    innod_metajson jsonb,
    simple_metajson jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.brd_sections OWNER TO postgres;

--
-- Name: brd_sections_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.brd_sections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.brd_sections_id_seq OWNER TO postgres;

--
-- Name: brd_sections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.brd_sections_id_seq OWNED BY public.brd_sections.id;


--
-- Name: brd_versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.brd_versions (
    id integer NOT NULL,
    brd_id text NOT NULL,
    version_num integer NOT NULL,
    label text NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    scope jsonb,
    metadata jsonb,
    toc jsonb,
    citations jsonb,
    content_profile jsonb,
    brd_config jsonb
);


ALTER TABLE public.brd_versions OWNER TO postgres;

--
-- Name: brd_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.brd_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.brd_versions_id_seq OWNER TO postgres;

--
-- Name: brd_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.brd_versions_id_seq OWNED BY public.brd_versions.id;


--
-- Name: brds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.brds (
    brd_id text NOT NULL,
    title text NOT NULL,
    format public.brd_format_enum DEFAULT 'NEW'::public.brd_format_enum NOT NULL,
    status public.brd_status_enum DEFAULT 'DRAFT'::public.brd_status_enum NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by_id integer NOT NULL,
    upload_id integer
);


ALTER TABLE public.brds OWNER TO postgres;

--
-- Name: file_outputs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.file_outputs (
    id integer NOT NULL,
    upload_id integer NOT NULL,
    filename text NOT NULL,
    storage_path text NOT NULL,
    file_size integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.file_outputs OWNER TO postgres;

--
-- Name: file_outputs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.file_outputs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.file_outputs_id_seq OWNER TO postgres;

--
-- Name: file_outputs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.file_outputs_id_seq OWNED BY public.file_outputs.id;


--
-- Name: file_uploads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.file_uploads (
    id integer NOT NULL,
    original_name text NOT NULL,
    file_type text NOT NULL,
    file_size integer NOT NULL,
    storage_path text NOT NULL,
    status public.task_status_enum DEFAULT 'PENDING'::public.task_status_enum NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    submitted_at timestamp with time zone,
    uploaded_by_id integer NOT NULL
);


ALTER TABLE public.file_uploads OWNER TO postgres;

--
-- Name: file_uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.file_uploads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.file_uploads_id_seq OWNER TO postgres;

--
-- Name: file_uploads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.file_uploads_id_seq OWNED BY public.file_uploads.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.notifications_id_seq OWNER TO postgres;

--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: password_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.password_history (
    id integer NOT NULL,
    user_id integer NOT NULL,
    hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.password_history OWNER TO postgres;

--
-- Name: password_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.password_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.password_history_id_seq OWNER TO postgres;

--
-- Name: password_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.password_history_id_seq OWNED BY public.password_history.id;


--
-- Name: task_assignees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.task_assignees (
    id integer NOT NULL,
    assignment_id integer NOT NULL,
    user_id integer NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.task_assignees OWNER TO postgres;

--
-- Name: task_assignees_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.task_assignees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.task_assignees_id_seq OWNER TO postgres;

--
-- Name: task_assignees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.task_assignees_id_seq OWNED BY public.task_assignees.id;


--
-- Name: task_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.task_assignments (
    id integer NOT NULL,
    title text NOT NULL,
    description text,
    status public.assignment_status DEFAULT 'PENDING'::public.assignment_status NOT NULL,
    percentage integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    due_date timestamp with time zone,
    team_id integer NOT NULL,
    created_by_id integer NOT NULL,
    brd_file_id integer
);


ALTER TABLE public.task_assignments OWNER TO postgres;

--
-- Name: task_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.task_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.task_assignments_id_seq OWNER TO postgres;

--
-- Name: task_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.task_assignments_id_seq OWNED BY public.task_assignments.id;


--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.task_comments (
    id integer NOT NULL,
    assignment_id integer NOT NULL,
    author_id integer NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.task_comments OWNER TO postgres;

--
-- Name: task_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.task_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.task_comments_id_seq OWNER TO postgres;

--
-- Name: task_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.task_comments_id_seq OWNED BY public.task_comments.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teams (
    id integer NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.teams OWNER TO postgres;

--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.teams_id_seq OWNER TO postgres;

--
-- Name: teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;


--
-- Name: user_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_logs (
    id integer NOT NULL,
    user_id integer NOT NULL,
    action text NOT NULL,
    details text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_logs OWNER TO postgres;

--
-- Name: user_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_logs_id_seq OWNER TO postgres;

--
-- Name: user_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_logs_id_seq OWNED BY public.user_logs.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_roles (
    id integer NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    features text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_roles OWNER TO postgres;

--
-- Name: user_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_roles_id_seq OWNER TO postgres;

--
-- Name: user_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_roles_id_seq OWNED BY public.user_roles.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    user_id text NOT NULL,
    password text NOT NULL,
    email text,
    first_name text,
    last_name text,
    role public.role_enum DEFAULT 'USER'::public.role_enum NOT NULL,
    status public.status_enum DEFAULT 'ACTIVE'::public.status_enum NOT NULL,
    last_login_at timestamp with time zone,
    password_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_id integer,
    team_id integer,
    user_role_id integer
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: validations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.validations (
    id integer NOT NULL,
    upload_id integer NOT NULL,
    validated_by_id integer NOT NULL,
    status text NOT NULL,
    remarks text,
    validated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.validations OWNER TO postgres;

--
-- Name: validations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.validations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.validations_id_seq OWNER TO postgres;

--
-- Name: validations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.validations_id_seq OWNED BY public.validations.id;


--
-- Name: app_settings id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings ALTER COLUMN id SET DEFAULT nextval('public.app_settings_id_seq'::regclass);


--
-- Name: brd_cell_images id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_cell_images ALTER COLUMN id SET DEFAULT nextval('public.brd_cell_images_id_seq'::regclass);


--
-- Name: brd_sections id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_sections ALTER COLUMN id SET DEFAULT nextval('public.brd_sections_id_seq'::regclass);


--
-- Name: brd_versions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_versions ALTER COLUMN id SET DEFAULT nextval('public.brd_versions_id_seq'::regclass);


--
-- Name: file_outputs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.file_outputs ALTER COLUMN id SET DEFAULT nextval('public.file_outputs_id_seq'::regclass);


--
-- Name: file_uploads id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.file_uploads ALTER COLUMN id SET DEFAULT nextval('public.file_uploads_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: password_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_history ALTER COLUMN id SET DEFAULT nextval('public.password_history_id_seq'::regclass);


--
-- Name: task_assignees id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignees ALTER COLUMN id SET DEFAULT nextval('public.task_assignees_id_seq'::regclass);


--
-- Name: task_assignments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignments ALTER COLUMN id SET DEFAULT nextval('public.task_assignments_id_seq'::regclass);


--
-- Name: task_comments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_comments ALTER COLUMN id SET DEFAULT nextval('public.task_comments_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);


--
-- Name: user_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_logs ALTER COLUMN id SET DEFAULT nextval('public.user_logs_id_seq'::regclass);


--
-- Name: user_roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles ALTER COLUMN id SET DEFAULT nextval('public.user_roles_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: validations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validations ALTER COLUMN id SET DEFAULT nextval('public.validations_id_seq'::regclass);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: brd_cell_images brd_cell_images_brd_id_table_index_row_index_col_index_rid_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_cell_images
    ADD CONSTRAINT brd_cell_images_brd_id_table_index_row_index_col_index_rid_key UNIQUE (brd_id, table_index, row_index, col_index, rid);


--
-- Name: brd_cell_images brd_cell_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_cell_images
    ADD CONSTRAINT brd_cell_images_pkey PRIMARY KEY (id);


--
-- Name: brd_sections brd_sections_brd_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_sections
    ADD CONSTRAINT brd_sections_brd_id_key UNIQUE (brd_id);


--
-- Name: brd_sections brd_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_sections
    ADD CONSTRAINT brd_sections_pkey PRIMARY KEY (id);


--
-- Name: brd_versions brd_versions_brd_id_version_num_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_versions
    ADD CONSTRAINT brd_versions_brd_id_version_num_key UNIQUE (brd_id, version_num);


--
-- Name: brd_versions brd_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_versions
    ADD CONSTRAINT brd_versions_pkey PRIMARY KEY (id);


--
-- Name: brds brds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brds
    ADD CONSTRAINT brds_pkey PRIMARY KEY (brd_id);


--
-- Name: brds brds_upload_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brds
    ADD CONSTRAINT brds_upload_id_key UNIQUE (upload_id);


--
-- Name: file_outputs file_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.file_outputs
    ADD CONSTRAINT file_outputs_pkey PRIMARY KEY (id);


--
-- Name: file_outputs file_outputs_upload_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.file_outputs
    ADD CONSTRAINT file_outputs_upload_id_key UNIQUE (upload_id);


--
-- Name: file_uploads file_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: password_history password_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_history
    ADD CONSTRAINT password_history_pkey PRIMARY KEY (id);


--
-- Name: task_assignees task_assignees_assignment_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignees
    ADD CONSTRAINT task_assignees_assignment_id_user_id_key UNIQUE (assignment_id, user_id);


--
-- Name: task_assignees task_assignees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignees
    ADD CONSTRAINT task_assignees_pkey PRIMARY KEY (id);


--
-- Name: task_assignments task_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_pkey PRIMARY KEY (id);


--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);


--
-- Name: teams teams_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_name_key UNIQUE (name);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: teams teams_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_slug_key UNIQUE (slug);


--
-- Name: user_logs user_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_logs
    ADD CONSTRAINT user_logs_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_name_key UNIQUE (name);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_slug_key UNIQUE (slug);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_user_id_key UNIQUE (user_id);


--
-- Name: validations validations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validations
    ADD CONSTRAINT validations_pkey PRIMARY KEY (id);


--
-- Name: validations validations_upload_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validations
    ADD CONSTRAINT validations_upload_id_key UNIQUE (upload_id);


--
-- Name: idx_brd_cell_images_brd_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_brd_cell_images_brd_id ON public.brd_cell_images USING btree (brd_id);


--
-- Name: idx_brd_cell_images_brd_id_section; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_brd_cell_images_brd_id_section ON public.brd_cell_images USING btree (brd_id, section);


--
-- Name: idx_brd_versions_brd_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_brd_versions_brd_id ON public.brd_versions USING btree (brd_id);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_password_history_user_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_password_history_user_created ON public.password_history USING btree (user_id, created_at);


--
-- Name: brd_cell_images brd_cell_images_brd_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_cell_images
    ADD CONSTRAINT brd_cell_images_brd_id_fkey FOREIGN KEY (brd_id) REFERENCES public.brd_sections(brd_id) ON DELETE CASCADE;


--
-- Name: brd_sections brd_sections_brd_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_sections
    ADD CONSTRAINT brd_sections_brd_id_fkey FOREIGN KEY (brd_id) REFERENCES public.brds(brd_id) ON DELETE CASCADE;


--
-- Name: brd_versions brd_versions_brd_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brd_versions
    ADD CONSTRAINT brd_versions_brd_id_fkey FOREIGN KEY (brd_id) REFERENCES public.brds(brd_id) ON DELETE CASCADE;


--
-- Name: brds brds_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brds
    ADD CONSTRAINT brds_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: brds brds_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brds
    ADD CONSTRAINT brds_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.file_uploads(id);


--
-- Name: file_outputs file_outputs_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.file_outputs
    ADD CONSTRAINT file_outputs_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.file_uploads(id);


--
-- Name: file_uploads file_uploads_uploaded_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_uploaded_by_id_fkey FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_history password_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_history
    ADD CONSTRAINT password_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_assignees task_assignees_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignees
    ADD CONSTRAINT task_assignees_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.task_assignments(id) ON DELETE CASCADE;


--
-- Name: task_assignees task_assignees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignees
    ADD CONSTRAINT task_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: task_assignments task_assignments_brd_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_brd_file_id_fkey FOREIGN KEY (brd_file_id) REFERENCES public.file_uploads(id);


--
-- Name: task_assignments task_assignments_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: task_assignments task_assignments_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: task_comments task_comments_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.task_assignments(id) ON DELETE CASCADE;


--
-- Name: task_comments task_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: user_logs user_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_logs
    ADD CONSTRAINT user_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users users_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: users users_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: users users_user_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_user_role_id_fkey FOREIGN KEY (user_role_id) REFERENCES public.user_roles(id);


--
-- Name: validations validations_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validations
    ADD CONSTRAINT validations_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.file_uploads(id);


--
-- Name: validations validations_validated_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validations
    ADD CONSTRAINT validations_validated_by_id_fkey FOREIGN KEY (validated_by_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict pKqN2Mr5DQlro3tsjZMssfIqdhfiLbYBHII8uuS2UWsKP1jVqzeJwOwzzICcIuu

